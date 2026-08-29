"""규칙 단위 검사.

케이스가 아니라 규칙 함수에 값을 직접 넣어 확인한다. 케이스로만 검증하면 그 케이스가
안 밟는 경로는 규칙이 뒤집혀도 그대로 통과한다. 여기 있는 검사는 케이스가 하나도
없어도 돌고, 규칙이 뒤집히면 바로 깨진다.
"""

from . import thresholds as T
from .common import MISSING, UNDECIDED, is_number, is_state
from .features.account import cash_buffer_days
from .features.card_sales import _peak_calendar_months
from .features.combined import payable_cashflow
from .features.documents import _industry_code
from .scorecard import EXCLUDED, _confirmed_orders, _plan_realism

import pandas as pd


def _monthly(sales):
    months = pd.period_range("2025-08", periods=len(sales), freq="M")
    return pd.DataFrame({"month": months, "sales": [float(v) for v in sales]})


def _booking(weeks, deposit):
    return _confirmed_orders({"own_booking_coverage_weeks": weeks,
                              "own_confirmed_order_deposit_flag": deposit})["points"]


def check_booking_deposit_never_lowers():
    """같은 주 수에서 계약금을 받은 쪽이 못 받은 쪽보다 낮은 점수가 되면 안 된다."""
    bad = [w for w in (1, 2, 3, 4, 5, 7, 8, 9, 12)
           if _booking(w, True) < _booking(w, False)]
    return not bad, "계약금이 감점이 되는 주 수 {}".format(bad) if bad else "주 수 9종 확인"


def check_booking_monotonic():
    """주 수가 늘 때 점수가 줄면 안 된다."""
    for deposit in (True, False):
        points = [_booking(w, deposit) for w in (0, 1, 4, 8, 12)]
        if any(b < a for a, b in zip(points, points[1:])):
            return False, "계약금 {}에서 {}".format(deposit, points)
    return True, "계약금 유무 양쪽에서 단조"


def check_payable_cashflow():
    """순현금흐름이 0 이하면 부담 비율의 분모로 쓰지 않는다."""
    cases = [(-3_000_000, MISSING), (0, MISSING), (1_000_000, 1_000_000), (MISSING, MISSING)]
    bad = [(v, payable_cashflow(v)) for v, want in cases if payable_cashflow(v) != want]
    return not bad, "{}".format(bad) if bad else "적자, 0, 흑자, 결측 확인"


def check_cash_buffer_never_negative():
    """잔액이 0 이하면 버틸 수 있는 일수가 음수가 아니라 0이다."""
    cases = [(-5_000_000, 700_000, 0.0), (0, 700_000, 0.0), (7_000_000, 700_000, 10.0)]
    bad = [(b, d, cash_buffer_days(b, d)) for b, d, want in cases
           if cash_buffer_days(b, d) != want]
    return not bad, "{}".format(bad) if bad else "음수, 0, 양수 잔액 확인"


def check_plan_realism_states():
    """다시 물어도 안 정한 것만 0점이다. 안 물어본 것은 제외다."""
    def band(target):
        return _plan_realism({"own_goal_target_value": target,
                              "own_goal_stretch_ratio": 1.2,
                              "own_plan_budget_to_cashflow_ratio": 0.5})

    undecided = band(UNDECIDED)
    missing = band(MISSING)
    ok = (undecided["points"] == 0 and undecided["band"] == "목표 안 정함"
          and missing["points"] is EXCLUDED)
    return ok, "UNDECIDED {}점 / MISSING {}".format(
        undecided["points"], "제외" if missing["points"] is EXCLUDED else missing["points"])


def check_seasonality_needs_a_real_peak():
    """평탄한 매출과 내내 줄어든 매출에서는 성수기 달을 뽑지 않는다."""
    flat = _peak_calendar_months(_monthly([30, 31, 30, 29, 30, 31, 30, 29, 30, 31, 30, 29]))
    declining = _peak_calendar_months(_monthly([34, 32, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12]))
    seasonal = _peak_calendar_months(_monthly([45, 22, 14, 10, 9, 8, 8, 11, 16, 24, 40, 46]))
    ok = flat == MISSING and declining == MISSING and seasonal == [6, 7, 8]
    return ok, "평탄 {} / 하락 {} / 계절 {}".format(flat, declining, seasonal)


def check_labor_resolution_needs_data():
    """일손이 풀렸다는 답은 반복 출금이 늘어 있을 때만 해소로 본다."""
    from .scorecard import _resolution_confirmed
    grew = {"fin_recurring_outflow_growth_3m": 0.12}
    flat = {"fin_recurring_outflow_growth_3m": 0.0}
    none = {"fin_recurring_outflow_growth_3m": MISSING}
    results = [
        _resolution_confirmed(grew, "일손", True)[0],
        _resolution_confirmed(flat, "일손", True)[0],
        _resolution_confirmed(none, "일손", True)[0],
        _resolution_confirmed(flat, "건강", True)[0],
        _resolution_confirmed(flat, "건강", False)[0],
    ]
    ok = results == [True, False, False, True, False]
    return ok, "일손 증가/평탄/결측 {} / 건강 예/아니오 {}".format(results[:3], results[3:])


def check_industry_code_enum():
    """업종 코드 11개 밖의 값은 쓰지 않는다."""
    bad = [v for v in ("한식 음식점", "", None, "restaurant") if _industry_code(v) != MISSING]
    ok = not bad and _industry_code("RESTAURANT") == "RESTAURANT"
    return ok, "enum 밖의 값이 통과 {}".format(bad) if bad else "enum 11개 안의 값만 통과"


def check_external_null_becomes_missing():
    """외부의 null은 내부의 MISSING으로 옮기고 0으로 채우지 않는다."""
    import json
    import os
    import tempfile
    from . import external

    payload = {"benchmarks": {"RESTAURANT": {"ext_peer_sales_growth_3m": 0.0259,
                                             "ext_industry_seasonality": None},
                              "INTERIOR": {name: None for name in external.EXT_FIELDS}}}
    root = tempfile.mkdtemp(prefix="external_")
    path = os.path.join(root, "peer_benchmark.json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle)

    filled = external.load("RESTAURANT", path)
    nulled = external.load("INTERIOR", path)
    unknown = external.load("NOT_AN_INDUSTRY", path)
    absent = external.load("RESTAURANT", os.path.join(root, "없는파일.json"))
    os.remove(path)
    os.rmdir(root)

    ok = (filled["ext_peer_sales_growth_3m"] == 0.0259
          and filled["ext_industry_seasonality"] == MISSING
          and filled["ext_peer_fixed_cost_ratio"] == MISSING
          and set(nulled.values()) == {MISSING}
          and set(unknown.values()) == {MISSING}
          and set(absent.values()) == {MISSING}
          and len(filled) == len(external.EXT_FIELDS))
    return ok, "값 1개 유지, null과 빠진 필드와 모르는 업종과 없는 파일은 MISSING"


def check_seasonality_question_boundary():
    """업종 계절성이 경계 이상일 때만 계절 질문의 답을 반드시 받는다."""
    from . import external
    below = external.seasonality_question_required(
        {"ext_industry_seasonality": T.EXT_SEASONALITY_QUESTION_MIN - 0.01})
    at = external.seasonality_question_required(
        {"ext_industry_seasonality": T.EXT_SEASONALITY_QUESTION_MIN})
    none = external.seasonality_question_required({"ext_industry_seasonality": MISSING})
    ok = below is False and at is True and none == MISSING
    return ok, "경계 {} 아래 {} / 경계 {} / 결측 {}".format(
        T.EXT_SEASONALITY_QUESTION_MIN, below, at, none)


def check_external_gap_needs_both_sides():
    """업종 대비 격차는 양쪽 값이 다 있을 때만 낸다."""
    from . import external
    both = external.sales_growth_gap(-0.20, {"ext_peer_sales_growth_3m": 0.0259})
    no_peer = external.sales_growth_gap(-0.20, {"ext_peer_sales_growth_3m": MISSING})
    no_own = external.sales_growth_gap(MISSING, {"ext_peer_sales_growth_3m": 0.0259})
    ok = abs(both - (-0.2259)) < 1e-9 and no_peer == MISSING and no_own == MISSING
    return ok, "양쪽 있음 {:+.4f} / 한쪽 없음 MISSING".format(both)


def check_growth_signal_sign_only():
    """경계가 같은 재료는 0을 위로 읽지 않는다."""
    from .common import signal_up
    low, high = T.SIGNAL_CASHFLOW_SLOPE
    values = [(-1.0, -1), (0.0, 0), (1.0, 1)]
    bad = [(v, signal_up(v, low, high)) for v, want in values if signal_up(v, low, high) != want]
    return not bad, "{}".format(bad) if bad else "음수, 0, 양수 확인"


CHECKS = (
    ("잡혀 있는 계약, 계약금이 감점이 아님", check_booking_deposit_never_lowers),
    ("잡혀 있는 계약, 주 수에 단조", check_booking_monotonic),
    ("적자면 부담 비율 분모로 안 씀", check_payable_cashflow),
    ("버틸 수 있는 일수가 음수 아님", check_cash_buffer_never_negative),
    ("안 정함과 안 물어봄을 구분", check_plan_realism_states),
    ("성수기는 진짜 피크일 때만", check_seasonality_needs_a_real_peak),
    ("일손 해소는 데이터로 대조", check_labor_resolution_needs_data),
    ("업종 코드는 enum 안에서만", check_industry_code_enum),
    ("경계가 같으면 부호만 봄", check_growth_signal_sign_only),
    ("외부 null은 MISSING으로", check_external_null_becomes_missing),
    ("계절 질문 경계", check_seasonality_question_boundary),
    ("업종 격차는 양쪽 있을 때만", check_external_gap_needs_both_sides),
)


def run():
    return [(name, ) + check() for name, check in CHECKS]


def main():
    for name, passed, note in run():
        print("  [{}] {:<32} {}".format("PASS" if passed else "FAIL", name, note))


if __name__ == "__main__":
    main()
