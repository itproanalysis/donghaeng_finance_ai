"""검증 스크립트. 단계별 완료 확인을 한 번에 돌린다."""

import json
import os

from . import triggers
from .build import FEATURE_ORDER, MOCK_DIR, build, case_path
from .common import MISSING, UNDECIDED, is_number, is_state

CASES = ("case_customer_drop", "case_ticket_drop", "case_operating_drop")
AFTER_CASE = "case_operating_drop_after"

# 아직 밟는 케이스가 없는 스코어카드 구간. 케이스를 늘리기 전까지 실행 증거가 없다.
# 이 목록과 실제 미실행 목록이 정확히 같아야 통과한다. 케이스를 더 만들거나 규칙을
# 고치면 여기도 같이 고쳐야 하고, 안 고치면 검증이 깨진다
BANDS_WITHOUT_CASE = (
    ("잔액 부족일", "1~2일"),
    ("잔액 부족일", "3~5일"),
    ("매출 대비 상환 부담", "10~20%"),
    ("버틸 수 있는 일수", "15~29일"),
    ("저점 회복", "회복 중"),
    ("잡혀 있는 계약", "4주 이상, 계약금 미확인"),
    ("잡혀 있는 계약", "4주 미만"),
    ("잡혀 있는 계약", "없음"),
    ("비용 줄일 여지", "15~30%"),
    ("비용 줄일 여지", "5~15%"),
    ("비용 줄일 여지", "5% 이하, 반복 출금이 거의 전부"),
    ("계획의 현실성", "배수 1.5배 이하, 예산 1배 이하 / 목표가 데이터와 어긋나 한 구간 아래"),
    ("계획의 현실성", "배수 2배 초과 또는 예산 부담 큼 / 목표가 데이터와 어긋나 한 구간 아래"),
)

# 규칙 커버리지를 세는 대상. docs/CASES.md에 적힌 9개와 같아야 한다
ALL_CASES = CASES + (
    AFTER_CASE,
    "case_no_answer",
    "case_cost_pressure",
    "case_demand_shift",
    "case_interior",
    "case_volatile",
    "case_new_low",
)

INPUT_FILES = ("card_sales.csv", "account_tx.csv", "account_meta.json",
               "card_spend.csv", "docs.json", "cb.json", "interview.json")

# 세 케이스를 구별해야 하는 피처
DISCRIMINATING = ("ops_transaction_count_avg_3m", "ops_avg_ticket_3m",
                  "biz_operating_day_count_avg_3m", "fin_sales_per_operating_day_3m")

TOLERANCE = 1e-9

# mock의 진술 매출이 실제 카드매출과 이 이상 벌어지면 설계하지 않은 진술 과장이 된다.
# 현금 장사 몫만큼 진술이 높은 것은 정상이므로 0은 아니다
STATED_SALES_GAP_MAX = 0.30


class Report(object):
    def __init__(self):
        self.results = []

    def check(self, step, name, passed, note=""):
        self.results.append((step, name, passed, note))
        print("  [{}] {:<34} {}".format("PASS" if passed else "FAIL", name, note))
        return passed

    def summary(self):
        print()
        failed = [r for r in self.results if not r[2]]
        for step in sorted({r[0] for r in self.results}):
            rows = [r for r in self.results if r[0] == step]
            ok = all(r[2] for r in rows)
            print("단계 {} {}  ({}/{})".format(
                step, "통과" if ok else "실패", sum(1 for r in rows if r[2]), len(rows)))
        print()
        print("전체 {}".format("통과" if not failed else "실패 {}건".format(len(failed))))
        return not failed


def same(values):
    first = values[0]
    if all(is_number(v) for v in values):
        return all(abs(float(v) - float(first)) <= TOLERANCE * max(1.0, abs(float(first)))
                   for v in values)
    return all(v == first for v in values)


def step1(report, built):
    print("단계 1. mock 케이스 3개")
    for case_id in CASES:
        missing = [f for f in INPUT_FILES if not os.path.exists(os.path.join(case_path(case_id), f))]
        report.check(1, "{} 입력 7개".format(case_id), not missing,
                     "없음: {}".format(missing) if missing else "7개 다 있음")
        has_expected = os.path.exists(os.path.join(case_path(case_id), "expected_features.json"))
        report.check(1, "{} expected".format(case_id), has_expected, "")

    growths = [built[p][0]["fin_sales_growth_3m"] for p in CASES]
    report.check(1, "세 케이스 매출 증가율 -20%", all(abs(g + 0.20) <= 1e-9 for g in growths),
                 "{}".format([round(g, 6) for g in growths]))

    mismatched = []
    for case_id in CASES:
        path = os.path.join(case_path(case_id), "expected_features.json")
        with open(path, encoding="utf-8") as handle:
            expected = json.load(handle)
        features = built[case_id][0]
        for name, want in expected.items():
            got = features.get(name)
            if is_number(want) and is_number(got):
                if abs(float(got) - float(want)) > TOLERANCE * max(1.0, abs(float(want))):
                    mismatched.append((case_id, name, want, got))
            elif got != want:
                mismatched.append((case_id, name, want, got))
    report.check(1, "expected_features 대조", not mismatched,
                 "{}개 항목 일치".format(sum(len(json.load(open(os.path.join(case_path(p), "expected_features.json"), encoding="utf-8"))) for p in CASES))
                 if not mismatched else "{}".format(mismatched[:4]))


def step2(report, built):
    print("\n단계 2. 피처 계산 함수")
    for case_id in list(CASES) + [AFTER_CASE]:
        features = built[case_id][0]
        report.check(2, "{} 94개 산출".format(case_id), len(features) == 94,
                     "{}개".format(len(features)))
        empty = [n for n in FEATURE_ORDER
                 if features.get(n) is None or (isinstance(features.get(n), float)
                                                and features[n] != features[n])]
        report.check(2, "{} 빈 값 없음".format(case_id), not empty, "{}".format(empty[:4]))


def step3(report, built):
    print("\n단계 3. 조건부 질문")
    fired = {p: triggers.evaluate(*built[p]) for p in CASES}
    report.check(3, "영업일 질문은 operating만",
                 fired["case_operating_drop"] == [triggers.Q_OPERATING_DAY_DROP]
                 and triggers.Q_OPERATING_DAY_DROP not in fired["case_customer_drop"]
                 and triggers.Q_OPERATING_DAY_DROP not in fired["case_ticket_drop"],
                 "{}".format({k: v for k, v in fired.items()}))
    others = {p: [c for c in fired[p] if c != triggers.Q_OPERATING_DAY_DROP] for p in CASES}
    report.check(3, "다른 질문은 안 나옴",
                 all(not v for v in others.values()), "{}".format(others))


def step4(report, built):
    print("\n단계 4. 검증")
    growths = [built[p][0]["fin_sales_growth_3m"] for p in CASES]
    report.check(4, "fin_sales_growth_3m 세 케이스 동일", same(growths),
                 "{}".format([round(g, 6) for g in growths]))

    profiles = {p: tuple(round(float(built[p][0][n]), 6) for n in DISCRIMINATING) for p in CASES}
    report.check(4, "4피처 조합이 케이스마다 구별", len(set(profiles.values())) == len(CASES), "")
    for name in DISCRIMINATING:
        values = [built[p][0][name] for p in CASES]
        note = " / ".join("{}={:,.4f}".format(p.replace("case_", ""), float(v))
                          for p, v in zip(CASES, values))
        report.check(4, "{} 최소 한 케이스 다름".format(name), not same(values), note)

    undecided_kept = []
    for case_id in CASES:
        with open(os.path.join(case_path(case_id), "interview.json"), encoding="utf-8") as handle:
            answers = json.load(handle)
        for key, value in answers.items():
            if value == UNDECIDED:
                undecided_kept.append((case_id, key, built[case_id][0].get(key)))
    report.check(4, "UNDECIDED가 상태로 남음",
                 bool(undecided_kept) and all(v == UNDECIDED for _, _, v in undecided_kept),
                 "{}".format(sorted({k for _, k, _ in undecided_kept})))

    identical = True
    for case_id in list(CASES) + [AFTER_CASE]:
        again, _ = build(case_path(case_id))
        first = built[case_id][0]
        if list(again.keys()) != list(first.keys()) or any(again[k] != first[k] for k in first):
            identical = False
    report.check(4, "같은 케이스 두 번 계산 일치", identical, "케이스 4개")


def step5(report, built):
    print("\n단계 5. 재평가 계산")
    before = built["case_operating_drop"][0]
    after = built[AFTER_CASE][0]
    goal_feature = before["own_goal_evidence_feature"]
    report.check(5, "재평가 케이스에 인터뷰 없음",
                 not built[AFTER_CASE][1]["has_interview"], "")
    from .features.interview import FEATURE_NAMES as INTERVIEW_NAMES
    report.check(5, "인터뷰 피처 30개가 상태",
                 all(is_state(after[n]) for n in INTERVIEW_NAMES),
                 "MISSING {}개".format(sum(1 for n in INTERVIEW_NAMES if after[n] == "MISSING")))
    report.check(5, "전과 후가 같은 함수",
                 is_number(before[goal_feature]) and is_number(after[goal_feature]),
                 "{} 전 {:.3f} 후 {:.3f} 목표 {}".format(
                     goal_feature, before[goal_feature], after[goal_feature],
                     before["own_goal_target_value"]))


def step6(report, built):
    print("\n단계 6. CB 대조 출력")
    from .cb_contrast import contrast
    payload = contrast("case_operating_drop")
    report.check(6, "dict 하나로 출력", isinstance(payload, dict), "키 {}개".format(len(payload)))
    report.check(6, "문장 생성 안 함",
                 payload.get("cb_opinion") == built["case_operating_drop"][1]["cb"]["opinion"],
                 "opinion 원문 그대로")


def step7(report, built):
    print("\n단계 7. 점수 계산")
    from .scorecard import score
    scores = {p: score(*built[p]) for p in CASES}
    current = [scores[p]["current_situation"]["score"] for p in CASES]
    report.check(7, "현재 상황 점수 세 케이스 동일", same(current),
                 "{}".format([round(c, 2) for c in current]))

    improvement = {p: scores[p]["improvement"]["score"] for p in CASES}
    best = max(improvement, key=improvement.get)
    report.check(7, "개선가능성은 operating이 최고",
                 best == "case_operating_drop"
                 and improvement["case_operating_drop"] > improvement["case_customer_drop"]
                 and improvement["case_operating_drop"] > improvement["case_ticket_drop"],
                 "{}".format({k.replace("case_", ""): round(v, 2) for k, v in improvement.items()}))

    differing = []
    for item in scores[CASES[0]]["improvement"]["items"]:
        name = item["name"]
        points = [next(i for i in scores[p]["improvement"]["items"] if i["name"] == name)["points"]
                  for p in CASES]
        if not same([p if p is not None else "제외" for p in points]):
            differing.append(name)
    report.check(7, "차이는 매출 방향에서만", differing == ["매출 방향"], "{}".format(differing))


def _item_of(axis, name):
    return next(i for i in axis["items"] if i["name"] == name)


def step11(report, built):
    print("\n단계 11. 케이스 확장과 규칙 커버리지")
    from .broken_inputs import run as run_broken
    from .scorecard import BANDS, EXCLUDED, score
    from . import triggers

    on_disk = sorted(os.listdir(MOCK_DIR))
    report.check(11, "케이스 10개가 실물로 있음", on_disk == sorted(ALL_CASES),
                 "{}개".format(len(on_disk)))

    scores = {c: score(*built[c]) for c in ALL_CASES}
    fired = {c: triggers.evaluate(*built[c]) for c in ALL_CASES}

    no_answer = scores["case_no_answer"]["improvement"]
    sales_item = _item_of(no_answer, "매출 방향")
    plan_item = _item_of(no_answer, "계획의 현실성")
    report.check(11, "case_no_answer 매출 방향 0점",
                 sales_item["points"] == 0 and sales_item["band"] == "하락, 사유 없음",
                 "{} {}".format(sales_item["band"], sales_item["note"]))
    report.check(11, "case_no_answer 계획 0점",
                 plan_item["points"] == 0 and plan_item["band"] == "목표 안 정함", "")
    lowest = min(scores[c]["improvement"]["score"] for c in CASES)
    report.check(11, "case_no_answer 개선가능성 최저",
                 no_answer["score"] < lowest,
                 "{:.1f} < 원인 구분 최저 {:.1f}".format(no_answer["score"], lowest))

    report.check(11, "case_cost_pressure 고정비, 잔액만",
                 fired["case_cost_pressure"] == [triggers.Q_FIXED_COST_INCREASE,
                                                 triggers.Q_LOW_BALANCE],
                 "{}".format(fired["case_cost_pressure"]))
    report.check(11, "case_demand_shift 매입, 배달, 주중만",
                 fired["case_demand_shift"] == [triggers.Q_PURCHASE_INCREASE,
                                                triggers.Q_DELIVERY_SHARE,
                                                triggers.Q_WEEKDAY_SHARE_CHANGE],
                 "{}".format(fired["case_demand_shift"]))

    interior = built["case_interior"][0]
    booking = _item_of(scores["case_interior"]["improvement"], "잡혀 있는 계약")
    report.check(11, "case_interior 잡혀 있는 계약 20점",
                 interior["biz_industry_code"] == "INTERIOR" and booking["points"] == 20,
                 "{} / {}".format(interior["biz_industry_code"], booking["band"]))

    new_low = scores["case_new_low"]
    trough = _item_of(new_low["improvement"], "저점 회복")
    report.check(11, "case_new_low 현재 상황 0점",
                 trough["points"] == 0 and trough["band"] == "지금이 제일 낮음"
                 and new_low["current_situation"]["score"] == 0.0,
                 "현재 상황 {:.1f}점, 5항목 전부 0점".format(
                     new_low["current_situation"]["score"]))

    volatile_axis = scores["case_volatile"]["improvement"]
    suspended = [_item_of(volatile_axis, n) for n in ("매출 방향", "저점 회복")]
    report.check(11, "case_volatile 성수기 진술 일치",
                 built["case_volatile"][0]["biz_seasonality_statement_match"] is True,
                 "진술 6~8월, 실제 피크 {}".format(
                     built["case_volatile"][1]["card_sales"]["peak_calendar_months"]))
    report.check(11, "case_volatile 오르내림 커서 방향 제외",
                 built["case_volatile"][0]["biz_sales_cv_6m"] >= 0.50
                 and all(i["points"] is EXCLUDED for i in suspended)
                 and volatile_axis["note"] == "매출 오르내림이 커서 방향 판단 제외",
                 "CV {:.3f}, {}항목으로 {:.1f}점".format(
                     built["case_volatile"][0]["biz_sales_cv_6m"],
                     volatile_axis["items_used"], volatile_axis["score"]))

    detail = {c: triggers.evaluate_detail(*built[c]) for c in ALL_CASES}
    never_fired = [code for code in triggers.QUESTION_ORDER
                   if not any(detail[c][code]["fired"] for c in ALL_CASES)]
    never_quiet = [code for code in triggers.QUESTION_ORDER
                   if all(detail[c][code]["fired"] for c in ALL_CASES)]
    report.check(11, "조건부 질문 6개, 나온 사례 있음", not never_fired,
                 "없음: {}".format(never_fired) if never_fired else "6개 전부")
    report.check(11, "조건부 질문 6개, 안 나온 사례 있음", not never_quiet,
                 "없음: {}".format(never_quiet) if never_quiet else "6개 전부")

    broken_results, broken_built = run_broken()
    graded = dict(scores)
    for name, pair in broken_built.items():
        graded["깨진 입력 " + name] = score(*pair)

    seen = set()
    for axes in graded.values():
        for axis in axes.values():
            for item in axis["items"]:
                seen.add((item["name"], item["band"]))
    unused = {(name, band) for name, bands in BANDS.items()
              for band in bands if (name, band) not in seen}
    declared = set(BANDS_WITHOUT_CASE)
    total = sum(len(b) for b in BANDS.values())
    new_gap = sorted(unused - declared)
    stale = sorted(declared - unused)
    report.check(11, "스코어카드 미실행 구간", not new_gap and not stale,
                 "{}/{} 구간 실행, 케이스 없는 {}개는 선언과 일치".format(
                     total - len(unused), total, len(unused))
                 if not new_gap and not stale
                 else "새로 생긴 미실행 {} / 낡은 선언 {}".format(new_gap, stale))

    for name, passed, note in broken_results:
        report.check(11, "깨진 입력 {}".format(name), passed, note)

    from .rule_checks import run as run_rules
    for name, passed, note in run_rules():
        report.check(11, "규칙 {}".format(name), passed, note)

    negative = [(c, built[c][0]["fin_min_daily_balance_3m"]) for c in ALL_CASES
                if is_number(built[c][0]["fin_min_daily_balance_3m"])
                and built[c][0]["fin_min_daily_balance_3m"] < 0]
    report.check(11, "케이스 잔액이 마이너스가 아님", not negative,
                 "{}".format(negative) if negative else "10개 전부 0 이상")

    overstated = [(c, round(built[c][0]["fin_stated_sales_gap"], 2)) for c in ALL_CASES
                  if is_number(built[c][0]["fin_stated_sales_gap"])
                  and abs(built[c][0]["fin_stated_sales_gap"]) > STATED_SALES_GAP_MAX]
    report.check(11, "케이스 진술 매출이 규모에 맞음", not overstated,
                 "{}".format(overstated) if overstated
                 else "차이 {:.0%} 이내".format(STATED_SALES_GAP_MAX))


def step12(report, built):
    print("\n단계 12. 외부 벤치마크 연결")
    from . import external
    from .cb_contrast import contrast
    from .scorecard import score

    available = external.source_available()
    report.check(12, "벤치마크 파일 상태", True,
                 "있음" if available else "없음, 전부 MISSING으로 동작")

    ext_in_features = [n for n in FEATURE_ORDER if n.startswith("ext_")]
    report.check(12, "피처 94개에 ext_ 없음", not ext_in_features,
                 "{}".format(ext_in_features) if ext_in_features else "94개 그대로")

    # 파일을 치웠을 때와 결과가 같아야 벤치마크가 점수에 안 들어간 것이다
    def fingerprint(case_id, path):
        saved = external.BENCHMARK_PATH
        external.BENCHMARK_PATH = path
        try:
            features, aux = build(case_path(case_id))
            axes = score(features, aux)
            return (tuple(features.items()), tuple(triggers.evaluate(features, aux)),
                    axes["current_situation"]["score"], axes["improvement"]["score"])
        finally:
            external.BENCHMARK_PATH = saved

    nowhere = os.path.join(MOCK_DIR, "없는_벤치마크.json")
    changed = [c for c in ALL_CASES
               if fingerprint(c, external.BENCHMARK_PATH) != fingerprint(c, nowhere)]
    report.check(12, "벤치마크가 피처와 점수를 안 바꿈", not changed,
                 "{}".format(changed) if changed else "파일 유무로 케이스 10개 결과 동일")

    interior = built["case_interior"][1]["external"]
    report.check(12, "case_interior는 ext_ 전부 MISSING",
                 set(interior.values()) == {MISSING},
                 "12필드 전부 MISSING")

    restaurant = built["case_customer_drop"][1]["external"]
    filled = sum(1 for v in restaurant.values() if is_number(v))
    report.check(12, "RESTAURANT 케이스에 벤치마크가 붙음",
                 filled > 0 if available else filled == 0,
                 "{}개 값".format(filled))

    payload = contrast("case_customer_drop")
    keys = ("ext_peer_sales_growth_3m", "ext_sales_growth_gap_peer",
            "seasonality_question_required")
    report.check(12, "CB 대조에 업종 재료가 실림",
                 all(k in payload for k in keys),
                 "{}".format({k: payload[k] for k in keys}))

    again = contrast("case_customer_drop")
    report.check(12, "CB 대조 두 번 실행 일치", again == payload, "")


# 앱이 받는 dict의 스키마. 키가 빠지거나 타입이 달라지면 앱이 깨진다
AXIS_KEYS = ("score", "items", "items_used", "items_total", "basis", "note")
ITEM_KEYS = ("name", "points", "excluded", "band", "note")
SCORECARD_KEYS = ("case_id", "current_situation", "improvement")
CONTRAST_KEYS = ("cb_opinion", "biz_industry_code", "fin_sales_growth_3m",
                 "ops_transaction_count_avg_3m", "ops_count_growth_3m",
                 "ops_avg_ticket_3m", "ops_ticket_growth_3m",
                 "biz_operating_day_change_3m", "own_operating_day_drop_reason",
                 "own_operating_day_drop_resolved_flag", "ext_peer_sales_growth_3m",
                 "ext_sales_growth_gap_peer", "ext_industry_growth_6m",
                 "ext_industry_seasonality", "seasonality_question_required")
REEVALUATE_KEYS = ("before_case", "after_case", "goal_feature", "before", "after",
                   "target", "horizon_days", "reached")


def _scorecard_schema_errors(payload):
    """스코어카드 dict의 키와 타입을 본다. 점수와 배점은 숫자거나 상태 문자열이다."""
    errors = []
    for key in SCORECARD_KEYS:
        if key not in payload:
            errors.append("빠진 키 {}".format(key))
    for axis_key in ("current_situation", "improvement"):
        axis = payload.get(axis_key)
        if not isinstance(axis, dict):
            errors.append("{}가 dict가 아님".format(axis_key))
            continue
        for key in AXIS_KEYS:
            if key not in axis:
                errors.append("{}에 빠진 키 {}".format(axis_key, key))
        if not (is_number(axis.get("score")) or is_state(axis.get("score"))):
            errors.append("{} score가 숫자도 상태도 아님".format(axis_key))
        for item in axis.get("items", []):
            for key in ITEM_KEYS:
                if key not in item:
                    errors.append("항목 {}에 빠진 키 {}".format(item.get("name"), key))
            if item.get("excluded") != (item.get("points") is None):
                errors.append("항목 {}의 excluded와 points가 어긋남".format(item.get("name")))
            if not item.get("excluded") and not is_number(item.get("points")):
                errors.append("항목 {}의 points가 숫자가 아님".format(item.get("name")))
    return errors


def step13(report, built):
    print("\n단계 13. 앱이 소비할 JSON 출력")
    from .cb_contrast import contrast
    from .reevaluate import compare
    from .scorecard import payload as scorecard_payload

    errors = []
    for case_id in ALL_CASES:
        errors += ["{}: {}".format(case_id, e)
                   for e in _scorecard_schema_errors(scorecard_payload(case_id))]
    report.check(13, "스코어카드 스키마", not errors,
                 "{}".format(errors[:3]) if errors else "케이스 10개 통과")

    missing_keys = []
    for case_id in ALL_CASES:
        payload = contrast(case_id)
        missing_keys += ["{}: {}".format(case_id, k) for k in CONTRAST_KEYS
                         if k not in payload]
    report.check(13, "CB 대조 스키마", not missing_keys,
                 "{}".format(missing_keys[:3]) if missing_keys else
                 "{}개 키가 케이스 10개에 전부 있음".format(len(CONTRAST_KEYS)))

    row = compare()
    absent = [k for k in REEVALUATE_KEYS if k not in row]
    report.check(13, "재평가 스키마", not absent,
                 "{}".format(absent) if absent else "{}개 키".format(len(REEVALUATE_KEYS)))

    unserializable = []
    for case_id in ALL_CASES:
        for label, value in (("scorecard", scorecard_payload(case_id)),
                             ("cb_contrast", contrast(case_id))):
            try:
                text = json.dumps(value, ensure_ascii=False)
                if json.loads(text) != json.loads(json.dumps(value, ensure_ascii=False)):
                    unserializable.append((case_id, label, "왕복 불일치"))
            except (TypeError, ValueError) as error:
                unserializable.append((case_id, label, str(error)))
    try:
        json.dumps(compare(), ensure_ascii=False)
    except (TypeError, ValueError) as error:
        unserializable.append(("reevaluate", "compare", str(error)))
    report.check(13, "JSON 직렬화와 왕복", not unserializable,
                 "{}".format(unserializable[:2]) if unserializable
                 else "케이스 10개 x 2종과 재평가")

    differing = []
    for case_id in ALL_CASES:
        if scorecard_payload(case_id) != scorecard_payload(case_id):
            differing.append((case_id, "scorecard"))
        if contrast(case_id) != contrast(case_id):
            differing.append((case_id, "cb_contrast"))
    if compare() != compare():
        differing.append(("reevaluate", "compare"))
    report.check(13, "같은 입력 두 번 실행 일치", not differing, "{}".format(differing))

    sentences = [(case_id, item["note"]) for case_id in ALL_CASES
                 for axis in ("current_situation", "improvement")
                 for item in scorecard_payload(case_id)[axis]["items"]
                 if item["note"].endswith(("다.", "요.", "습니다."))]
    report.check(13, "문장을 만들지 않음", not sentences,
                 "{}".format(sentences[:2]) if sentences else "근거는 값과 구간 이름만")


def step14(report, built):
    print("\n단계 14. 문서와 코드 대조")
    from .doc_contract import run as run_contract
    for name, passed, note in run_contract():
        report.check(14, name, passed, note)


def main():
    built = {}
    for case_id in ALL_CASES:
        built[case_id] = build(case_path(case_id))

    report = Report()
    step1(report, built)
    step2(report, built)
    step3(report, built)
    step4(report, built)
    step5(report, built)
    step6(report, built)
    step7(report, built)
    step11(report, built)
    step12(report, built)
    step13(report, built)
    step14(report, built)
    ok = report.summary()
    raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
