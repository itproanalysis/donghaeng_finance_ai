"""웹 심사용 ``modeling_web_v1`` JSON bundle을 만든다.

이 모듈은 피처나 점수 규칙을 다시 구현하지 않는다. ``build``, ``triggers``,
``scorecard``, ``cb_contrast``, ``reevaluate``의 결과를 웹이 소비할 수 있는 안정된
계약으로 포장하고, 사람이 확인할 메타데이터와 score lineage를 덧붙인다.

mock 입력은 실제 고객 데이터나 예측 성능 검증 자료가 아니다. bundle에도 이 한계를
명시하며, 외부 업종 자료는 94개 피처와 점수 근거에서 완전히 분리한다.
"""

import argparse
import contextlib
import copy
import hashlib
import io
import json
import math
import os
import re
import shutil
import tempfile
from collections import Counter, defaultdict
from datetime import date, datetime

from . import external, thresholds as T, triggers, validate
from .build import FEATURE_ORDER, MOCK_DIR, SOURCE_OF, build, case_path
from .cb_contrast import contrast
from .common import MISSING, STATES, is_number, is_state
from .features.combined import FEATURE_NAMES as COMBINED_FEATURE_NAMES
from .features.interview import FEATURE_NAMES as INTERVIEW_FEATURE_NAMES
from .reevaluate import compare as reevaluate_compare
from .scorecard import BANDS, _making_new_low, score


ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEATURE_DOC = os.path.join(ROOT, "docs", "FEATURE_LIST.md")
CASES_DOC = os.path.join(ROOT, "docs", "CASES.md")

SCHEMA_VERSION = "modeling_web_v1"
MODEL_VERSION = "deterministic_scorecard_v1"
CASE_IDS = tuple(validate.ALL_CASES)
STATUS_ORDER = ("VALUE", MISSING, "REFUSED", "NOT_APPLICABLE", "UNDECIDED")

SOURCE_CODES = {
    "카드매출": "CARD_SALES",
    "계좌": "ACCOUNT",
    "카드 사용내역": "CARD_SPEND",
    "서류": "DOCUMENTS",
    "CB": "CB",
    "인터뷰": "INTERVIEW",
    "조합": "COMBINED",
}

SOURCE_LABELS = {
    "CARD_SALES": "카드매출",
    "ACCOUNT": "계좌",
    "CARD_SPEND": "카드 사용내역",
    "DOCUMENTS": "제출 서류",
    "CB": "CB 연계",
    "INTERVIEW": "AI 인터뷰",
    "COMBINED": "데이터 결합",
    "DERIVED_AUXILIARY": "계산 보조값",
    "CB_RAW": "CB 원천",
    "EXTERNAL_BENCHMARK": "업종 비교 참고자료",
}

LABEL_OVERRIDES = {
    "own_operating_day_drop_reason": "영업일 감소 원인",
    "own_operating_day_drop_resolved_flag": "영업일 감소 원인 해소 여부",
    "own_fixed_cost_increase_reason": "고정비 증가 원인",
    "own_low_balance_coping_method": "잔액 부족 대처 방법",
    "own_purchase_increase_reason": "매입 증가 원인",
    "ops_platform_fee_ratio": "플랫폼 수수료 비중",
    "biz_hall_customer_decline_flag": "홀 고객 감소 여부",
}

# mock 10개에서 값이 모두 상태 문자열인 수치 피처의 의도된 JSON 자료형.
DTYPE_OVERRIDES = {
    "own_essential_expense": "number",
    "own_fund_amount": "number",
    "own_fund_to_cashflow_ratio": "number",
}

TRIGGER_INPUTS = {
    triggers.Q_OPERATING_DAY_DROP: ("biz_operating_day_change_3m", "CARD_SALES"),
    triggers.Q_FIXED_COST_INCREASE: ("fin_recurring_outflow_growth_3m", "ACCOUNT"),
    triggers.Q_LOW_BALANCE: ("fin_low_balance_day_count_3m", "ACCOUNT"),
    triggers.Q_PURCHASE_INCREASE: ("fin_purchase_spend_growth_3m", "CARD_SPEND"),
    triggers.Q_DELIVERY_SHARE: ("delivery_share_recent", "CARD_SALES"),
    triggers.Q_WEEKDAY_SHARE_CHANGE: ("ops_weekday_sales_share_change", "COMBINED"),
}

TRIGGER_LABELS = {
    triggers.Q_OPERATING_DAY_DROP: "영업일 감소 원인 확인",
    triggers.Q_FIXED_COST_INCREASE: "고정비 증가 원인 확인",
    triggers.Q_LOW_BALANCE: "잔액 부족 대처 확인",
    triggers.Q_PURCHASE_INCREASE: "매입 증가 원인 확인",
    triggers.Q_DELIVERY_SHARE: "플랫폼 수수료 확인",
    triggers.Q_WEEKDAY_SHARE_CHANGE: "홀 고객 변화 확인",
}

TRIGGER_THRESHOLDS = {
    triggers.Q_OPERATING_DAY_DROP: {"operator": "LESS_THAN_OR_EQUAL", "value": T.TRIGGER_OPERATING_DAY_CHANGE},
    triggers.Q_FIXED_COST_INCREASE: {"operator": "GREATER_THAN_OR_EQUAL", "value": T.TRIGGER_RECURRING_OUTFLOW_GROWTH},
    triggers.Q_LOW_BALANCE: {"operator": "GREATER_THAN_OR_EQUAL", "value": T.TRIGGER_LOW_BALANCE_DAY_COUNT},
    triggers.Q_PURCHASE_INCREASE: {"operator": "GREATER_THAN_OR_EQUAL", "value": T.TRIGGER_PURCHASE_SPEND_GROWTH},
    triggers.Q_DELIVERY_SHARE: {"operator": "GREATER_THAN_OR_EQUAL", "value": T.TRIGGER_DELIVERY_SHARE},
    triggers.Q_WEEKDAY_SHARE_CHANGE: {"operator": "ABS_GREATER_THAN_OR_EQUAL", "value": T.TRIGGER_WEEKDAY_SHARE_CHANGE},
}

# scorecard가 직접 읽거나 score에 쓰이는 파생값의 재료가 되는 피처. 역할 표시는
# 설명용 metadata이고 실제 점수 산출은 언제나 scorecard.score가 한다.
SCORE_FEATURES = {
    "fin_cashflow_to_sales_ratio",
    "fin_net_cashflow_avg_3m",
    "fin_sales_avg_3m",
    "fin_net_cashflow_positive_month_ratio_6m",
    "fin_low_balance_day_count_3m",
    "crd_debt_payment_to_sales_ratio",
    "fin_cash_buffer_days_est",
    "fin_cash_outflow_avg_3m",
    "biz_sales_cv_6m",
    "fin_sales_growth_3m",
    "biz_operating_day_change_3m",
    "ops_count_growth_3m",
    "ops_ticket_growth_3m",
    "own_operating_day_drop_reason",
    "own_operating_day_drop_resolved_flag",
    "fin_recurring_outflow_growth_3m",
    "biz_sales_recovery_from_trough",
    "biz_sales_drawdown_from_peak",
    "own_booking_coverage_weeks",
    "own_confirmed_order_deposit_flag",
    "fin_recurring_outflow_avg_3m",
    "imp_cost_adjustment_headroom",
    "own_goal_evidence_feature",
    "own_goal_target_value",
    "own_plan_budget",
    "own_primary_problem",
    "own_goal_stretch_ratio",
    "own_plan_budget_to_cashflow_ratio",
    "imp_goal_data_alignment",
    # 목표 피처로 선택되면 계획 현실성의 목표 배수에 들어갈 수 있다.
    "ops_avg_ticket_3m",
    "ops_transaction_count_avg_3m",
    "biz_operating_day_count_avg_3m",
    "fin_recurring_outflow_count",
    "fin_min_daily_balance_3m",
}

QUESTION_TRIGGER_FEATURES = {
    feature for feature, _source in TRIGGER_INPUTS.values()
    if feature in FEATURE_ORDER
}


def _ensure_mock_cases():
    """mock가 없을 때만 고정 시드 생성기를 실행한다."""
    missing = [case_id for case_id in CASE_IDS if not os.path.isdir(case_path(case_id))]
    if not missing:
        return
    from .make_mock import main as make_mock

    with contextlib.redirect_stdout(io.StringIO()):
        make_mock()
    still_missing = [case_id for case_id in CASE_IDS if not os.path.isdir(case_path(case_id))]
    if still_missing:
        raise RuntimeError("mock 생성 후에도 케이스가 없습니다: {}".format(still_missing))


def _markdown_cells(line):
    return [cell.strip() for cell in line.strip().strip("|").split("|")]


def _plain_markdown(value):
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"\*\*([^*]+)\*\*", r"\1", value)
    return re.sub(r"\s+", " ", value).strip()


def _feature_doc_metadata():
    """FEATURE_LIST의 첫 번째 정의 표에서 한글명과 설명을 읽는다."""
    with open(FEATURE_DOC, encoding="utf-8") as handle:
        lines = handle.read().splitlines()

    feature_set = set(FEATURE_ORDER)
    result = {}
    prior_condition = ""
    prior_question = ""
    for line in lines:
        if not line.startswith("|"):
            continue
        cells = _markdown_cells(line)
        if len(cells) == 4:
            if cells[0]:
                prior_condition = _plain_markdown(cells[0])
            if cells[1]:
                prior_question = _plain_markdown(cells[1])
        codes = re.findall(r"`([a-z][a-z0-9_]+)`", line)
        for code in codes:
            if code not in feature_set or code in result:
                continue
            code_cell = next((index for index, cell in enumerate(cells) if "`{}`".format(code) in cell), -1)
            if code_cell == 1 and len(cells) >= 3:
                label = _plain_markdown(cells[0])
                description = _plain_markdown(cells[2])
            elif code_cell == 3 and len(cells) == 4:
                label = _plain_markdown(cells[2]) or code
                description = " · ".join(part for part in (prior_condition, prior_question) if part)
            else:
                label = code
                description = ""
            result[code] = {
                "label": LABEL_OVERRIDES.get(code, label or code),
                "description": description or "docs/FEATURE_LIST.md에 정의된 분석 피처",
            }

    missing = [code for code in FEATURE_ORDER if code not in result]
    if missing:
        raise ValueError("FEATURE_LIST에서 metadata를 찾지 못했습니다: {}".format(missing))
    return result


def _case_doc_metadata():
    with open(CASES_DOC, encoding="utf-8") as handle:
        lines = handle.read().splitlines()
    result = {}
    for line in lines:
        match = re.match(r"^\|\s*(\d+)\s*\|\s*(case_[a-z_]+)\s*\|\s*([^|]+)\|\s*([^|]+)\|", line)
        if not match:
            continue
        case_id = match.group(2)
        result[case_id] = {
            "ordinal": int(match.group(1)),
            "title": _plain_markdown(match.group(3)),
            "verificationPurpose": _plain_markdown(match.group(4)),
        }
    missing = [case_id for case_id in CASE_IDS if case_id not in result]
    if missing:
        raise ValueError("CASES 문서에서 metadata를 찾지 못했습니다: {}".format(missing))
    return result


def _json_safe(value):
    if value is None or isinstance(value, (str, bool, int)):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError("JSON에 쓸 수 없는 숫자입니다: {}".format(value))
        return value
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_json_safe(item) for item in value]
    item = getattr(value, "item", None)
    if callable(item):
        return _json_safe(item())
    raise TypeError("지원하지 않는 JSON 값입니다: {}".format(type(value).__name__))


def _status(value):
    return value if is_state(value) else "VALUE"


def _value_dtype(value):
    if is_state(value) or value is None:
        return None
    if isinstance(value, bool):
        return "boolean"
    if is_number(value):
        return "number"
    if isinstance(value, str):
        return "string"
    if isinstance(value, dict):
        return "object"
    if isinstance(value, (list, tuple)):
        non_empty = [item for item in value if item is not None]
        if non_empty and all(is_number(item) for item in non_empty):
            return "number[]"
        if non_empty and all(isinstance(item, str) for item in non_empty):
            return "string[]"
        return "array"
    return None


def _dtype_map(built):
    result = {}
    for code in FEATURE_ORDER:
        observed = {
            dtype for dtype in (_value_dtype(built[case_id][0][code]) for case_id in CASE_IDS)
            if dtype is not None
        }
        if len(observed) > 1:
            raise TypeError("피처 {}의 JSON 자료형이 케이스마다 다릅니다: {}".format(code, sorted(observed)))
        dtype = next(iter(observed), DTYPE_OVERRIDES.get(code))
        if dtype is None:
            raise TypeError("피처 {}의 자료형을 확인할 값이나 override가 없습니다".format(code))
        result[code] = dtype
    return result


def _roles(code):
    roles = []
    if code in SCORE_FEATURES:
        roles.append("SCORE")
    if code in COMBINED_FEATURE_NAMES:
        roles.append("DERIVED")
    if code in QUESTION_TRIGGER_FEATURES:
        roles.append("QUESTION_TRIGGER")
    if not roles:
        roles.append("CONTEXT")
    return roles


def _feature_catalog(built):
    docs = _feature_doc_metadata()
    dtypes = _dtype_map(built)
    catalog = []
    for ordinal, code in enumerate(FEATURE_ORDER, start=1):
        source = SOURCE_CODES[SOURCE_OF[code]]
        roles = _roles(code)
        catalog.append({
            "ordinal": ordinal,
            "code": code,
            "label": docs[code]["label"],
            "description": docs[code]["description"],
            "source": source,
            "sourceLabel": SOURCE_LABELS[source],
            "dtype": dtypes[code],
            "role": roles[0],
            "roles": roles,
            "featureVectorMember": True,
            "usedInScore": "SCORE" in roles,
            "usedForQuestionTrigger": "QUESTION_TRIGGER" in roles,
        })
    return catalog


def _load_interview(case_id):
    path = os.path.join(case_path(case_id), "interview.json")
    if not os.path.exists(path):
        return None
    with open(path, encoding="utf-8") as handle:
        value = json.load(handle)
    return value if isinstance(value, dict) else None


def _evidence_id(case_id, feature, text):
    digest = hashlib.sha256(
        "{}\0{}\0{}".format(case_id, feature, text).encode("utf-8")
    ).hexdigest()[:20]
    return "interview-evidence-{}".format(digest)


def _interview_conversion(case_id, features, meta_by_code):
    interview = _load_interview(case_id)
    evidence_text = interview.get("evidence_text", {}) if interview else {}
    if not isinstance(evidence_text, dict):
        evidence_text = {}

    evidence_by_feature = {}
    items = []
    for code in INTERVIEW_FEATURE_NAMES:
        text = evidence_text.get(code)
        text = text.strip() if isinstance(text, str) and text.strip() else None
        evidence_id = _evidence_id(case_id, code, text) if text else None
        if evidence_id:
            evidence_by_feature[code] = [evidence_id]
        items.append({
            "feature": code,
            "label": meta_by_code[code]["label"],
            "value": _json_safe(features[code]),
            "status": _status(features[code]),
            "evidenceId": evidence_id,
            "evidenceText": text,
            "evidencePresent": evidence_id is not None,
        })

    stated = interview.get("stated_monthly_sales", MISSING) if interview else MISSING
    return {
        "method": "STRUCTURED_INTERVIEW_MAPPING",
        "interviewPresent": interview is not None,
        "items": items,
        "rawMaterials": [{
            "code": "stated_monthly_sales",
            "value": _json_safe(stated),
            "status": _status(stated),
            "usedBy": ["fin_stated_sales_gap", "fin_sales_consistency_score"],
        }],
        "disclaimer": (
            "현재 Python 기준 구현은 구조화된 인터뷰 값을 입력받습니다. "
            "자유 발화에서 보기값으로 매핑하는 과정은 인터뷰 계층의 책임입니다."
        ),
    }, evidence_by_feature


def _feature_rows(features, catalog, evidence_by_feature):
    rows = []
    for meta in catalog:
        code = meta["code"]
        row = dict(meta)
        row.update({
            "value": _json_safe(features[code]),
            "status": _status(features[code]),
            "evidenceRefs": list(evidence_by_feature.get(code, [])),
        })
        rows.append(row)
    return rows


def _status_counts(rows):
    counts = Counter(row["status"] for row in rows)
    return {status: counts.get(status, 0) for status in STATUS_ORDER}


def _source_summary(rows):
    grouped = defaultdict(list)
    for row in rows:
        grouped[row["source"]].append(row)
    summary = []
    for source in SOURCE_CODES.values():
        source_rows = grouped[source]
        summary.append({
            "source": source,
            "sourceLabel": SOURCE_LABELS[source],
            "featureCount": len(source_rows),
            "valueCount": sum(1 for row in source_rows if row["status"] == "VALUE"),
            "statusCounts": _status_counts(source_rows),
        })
    return summary


def _feature_lineage(code, features, meta_by_code, evidence_by_feature):
    if code.startswith("ext_"):
        raise AssertionError("외부 context는 score lineage에 넣을 수 없습니다")
    meta = meta_by_code[code]
    return {
        "kind": "FEATURE",
        "feature": code,
        "label": meta["label"],
        "source": meta["source"],
        "sourceLabel": meta["sourceLabel"],
        "value": _json_safe(features[code]),
        "status": _status(features[code]),
        "featureVectorMember": True,
        "evidenceRefs": list(evidence_by_feature.get(code, [])),
    }


def _aux_lineage(code, label, source, value):
    if code.startswith("ext_") or source == "EXTERNAL_BENCHMARK":
        raise AssertionError("외부 context는 score lineage에 넣을 수 없습니다")
    return {
        "kind": "AUXILIARY",
        "feature": code,
        "label": label,
        "source": source,
        "sourceLabel": SOURCE_LABELS[source],
        "value": _json_safe(value),
        "status": _status(value),
        "featureVectorMember": False,
        "evidenceRefs": [],
    }


def _item_lineage(item_name, features, aux, meta_by_code, evidence_by_feature):
    feature_codes = []
    auxiliary = []
    if item_name == "매출 대비 남는 비율":
        feature_codes = ["fin_cashflow_to_sales_ratio", "fin_net_cashflow_avg_3m", "fin_sales_avg_3m"]
    elif item_name == "흑자월 비율":
        feature_codes = ["fin_net_cashflow_positive_month_ratio_6m"]
    elif item_name == "잔액 부족일":
        feature_codes = ["fin_low_balance_day_count_3m"]
    elif item_name == "매출 대비 상환 부담":
        feature_codes = ["crd_debt_payment_to_sales_ratio", "fin_sales_avg_3m"]
        auxiliary.append(_aux_lineage(
            "cb_monthly_debt_payment", "월 상환액", "CB_RAW",
            aux.get("cb", {}).get("monthly_debt_payment", MISSING),
        ))
    elif item_name == "버틸 수 있는 일수":
        feature_codes = ["fin_cash_buffer_days_est", "fin_cash_outflow_avg_3m"]
    elif item_name == "매출 방향":
        feature_codes = [
            "biz_sales_cv_6m",
            "fin_sales_growth_3m",
            "biz_operating_day_change_3m",
            "ops_count_growth_3m",
            "ops_ticket_growth_3m",
            "own_operating_day_drop_reason",
            "own_operating_day_drop_resolved_flag",
        ]
        reason = features.get("own_operating_day_drop_reason")
        if reason == T.DATA_CHECKED_OPERATING_DAY_REASON:
            feature_codes.append("fin_recurring_outflow_growth_3m")
        auxiliary.extend([
            _aux_lineage(
                "sales_drop_driver", "매출 하락 원인", "DERIVED_AUXILIARY",
                aux.get("combined", {}).get("sales_drop_driver", MISSING),
            ),
            _aux_lineage(
                "sales_per_operating_day_growth_3m", "영업일당 매출 증가율", "DERIVED_AUXILIARY",
                aux.get("card_sales", {}).get("sales_per_operating_day_growth_3m", MISSING),
            ),
        ])
    elif item_name == "저점 회복":
        feature_codes = [
            "biz_sales_cv_6m",
            "biz_sales_drawdown_from_peak",
            "biz_sales_recovery_from_trough",
        ]
        auxiliary.append(_aux_lineage(
            "latest_month_is_new_low", "최근 월이 새 저점인지", "DERIVED_AUXILIARY",
            _making_new_low(aux),
        ))
    elif item_name == "잡혀 있는 계약":
        feature_codes = ["own_booking_coverage_weeks", "own_confirmed_order_deposit_flag"]
    elif item_name == "비용 줄일 여지":
        feature_codes = [
            "fin_cash_outflow_avg_3m",
            "fin_recurring_outflow_avg_3m",
            "imp_cost_adjustment_headroom",
        ]
    elif item_name == "계획의 현실성":
        feature_codes = [
            "own_goal_evidence_feature",
            "own_goal_target_value",
            "own_plan_budget",
            "fin_net_cashflow_avg_3m",
            "own_goal_stretch_ratio",
            "own_plan_budget_to_cashflow_ratio",
            "own_primary_problem",
            "imp_goal_data_alignment",
        ]
        goal_feature = features.get("own_goal_evidence_feature")
        if isinstance(goal_feature, str) and goal_feature in meta_by_code:
            feature_codes.insert(2, goal_feature)
        auxiliary.append(_aux_lineage(
            "sales_drop_driver", "매출 하락 원인", "DERIVED_AUXILIARY",
            aux.get("combined", {}).get("sales_drop_driver", MISSING),
        ))
    else:
        raise KeyError("알 수 없는 score item입니다: {}".format(item_name))

    seen = set()
    lineage = []
    for code in feature_codes:
        if code in seen:
            continue
        seen.add(code)
        lineage.append(_feature_lineage(code, features, meta_by_code, evidence_by_feature))
    lineage.extend(auxiliary)
    return lineage


def _axis_view(axis_code, raw_axis, features, aux, meta_by_code, evidence_by_feature):
    included = [item for item in raw_axis["items"] if not item["excluded"]]
    denominator = T.AXIS_ITEM_POINTS * len(included)
    numerator = sum(item["points"] for item in included)
    items = []
    for raw_item in raw_axis["items"]:
        items.append({
            "name": raw_item["name"],
            "points": _json_safe(raw_item["points"]),
            "maxPoints": T.AXIS_ITEM_POINTS,
            "excluded": raw_item["excluded"],
            "band": raw_item["band"],
            "note": raw_item["note"],
            "normalizedContribution": (
                float(raw_item["points"]) / denominator * 100
                if denominator and not raw_item["excluded"] else None
            ),
            "lineage": _item_lineage(
                raw_item["name"], features, aux, meta_by_code, evidence_by_feature
            ),
        })
    return {
        "axis": axis_code,
        "score": _json_safe(raw_axis["score"]),
        "itemsUsed": raw_axis["items_used"],
        "itemsTotal": raw_axis["items_total"],
        "basis": raw_axis["basis"],
        "note": raw_axis.get("note", ""),
        "items": items,
        "accounting": {
            "earnedPoints": numerator,
            "availablePoints": denominator,
            "totalPossiblePoints": T.AXIS_ITEM_POINTS * len(raw_axis["items"]),
            "coverageRatio": len(included) / len(raw_axis["items"]) if raw_axis["items"] else 0,
            "formula": "SUM_INCLUDED_POINTS / SUM_INCLUDED_MAX_POINTS * 100",
            "excludedItems": [item["name"] for item in raw_axis["items"] if item["excluded"]],
            "isConfidence": False,
        },
    }


def _scorecard_view(features, aux, meta_by_code, evidence_by_feature):
    raw = score(features, aux)
    return {
        "currentSituation": _axis_view(
            "CURRENT_SITUATION", raw["current_situation"], features, aux,
            meta_by_code, evidence_by_feature,
        ),
        "improvement": _axis_view(
            "IMPROVEMENT_POTENTIAL", raw["improvement"], features, aux,
            meta_by_code, evidence_by_feature,
        ),
        "disclaimer": (
            "학습모델이나 승인·거절 판단이 아닌 설명 가능한 규칙 기반 심사 보조 prototype입니다."
        ),
    }


def _trigger_view(features, aux):
    detail = triggers.evaluate_detail(features, aux)
    rows = []
    for code in triggers.QUESTION_ORDER:
        input_feature, source = TRIGGER_INPUTS[code]
        value = detail[code]["value"]
        rows.append({
            "code": code,
            "label": TRIGGER_LABELS[code],
            "fired": detail[code]["fired"],
            "inputFeature": input_feature,
            "inputFeatureVectorMember": input_feature in FEATURE_ORDER,
            "inputSource": source,
            "inputValue": _json_safe(value),
            "inputStatus": _status(value),
            "threshold": dict(TRIGGER_THRESHOLDS[code]),
            "fills": list(triggers.FILLS[code]),
        })
    return rows


def _cb_contrast_view(case_id, features, aux, meta_by_code, evidence_by_feature):
    raw = contrast(case_id)
    cb = aux.get("cb", {})
    context_codes = [
        "biz_industry_code",
        "fin_sales_growth_3m",
        "ops_transaction_count_avg_3m",
        "ops_count_growth_3m",
        "ops_avg_ticket_3m",
        "ops_ticket_growth_3m",
        "biz_operating_day_change_3m",
        "own_operating_day_drop_reason",
        "own_operating_day_drop_resolved_flag",
        "crd_debt_payment_to_sales_ratio",
    ]
    fields = []
    for code in context_codes:
        value = features[code]
        # contrast()가 책임지는 기존 9개 값은 실제 반환과 같은지 확인한다.
        if code in raw and raw[code] != value:
            raise AssertionError("cb_contrast와 build 값이 다릅니다: {}".format(code))
        fields.append(_feature_lineage(code, features, meta_by_code, evidence_by_feature))
    return {
        "legacyCb": {
            "score": _json_safe(cb.get("score", MISSING)),
            "grade": _json_safe(cb.get("grade", MISSING)),
            "percentile": _json_safe(cb.get("percentile", MISSING)),
            "delinquencyProbability": _json_safe(cb.get("delinquency_prob", MISSING)),
            "monthlyDebtPayment": _json_safe(cb.get("monthly_debt_payment", MISSING)),
            "opinion": raw["cb_opinion"],
        },
        "donghaengContext": {
            "fields": fields,
            "featureCount": len(fields),
        },
        "disclaimer": (
            "기존 CB를 대체하지 않습니다. 기존 정보만으로 설명되지 않는 사업 변화의 "
            "맥락을 추가하는 검토 자료입니다."
        ),
    }


def _external_context_view(features, aux):
    benchmark = aux.get("external", {})
    context = aux.get("external_context", {})
    fields = []
    for code in external.EXT_FIELDS:
        value = context.get(code, benchmark.get(code, MISSING))
        fields.append({
            "code": code,
            "source": "EXTERNAL_BENCHMARK",
            "sourceLabel": SOURCE_LABELS["EXTERNAL_BENCHMARK"],
            "dtype": "number",
            "role": "CONTEXT_ONLY",
            "roles": ["CONTEXT_ONLY"],
            "value": _json_safe(value),
            "status": _status(value),
            "featureVectorMember": False,
            "usedInScore": False,
        })
    required = context.get("seasonality_question_required", MISSING)
    return {
        "role": "CONTEXT_ONLY",
        "sourceAvailable": external.source_available(),
        "includedInFeatureVector": False,
        "includedInScore": False,
        "fields": fields,
        "seasonalityQuestionRequired": {
            "value": _json_safe(required),
            "status": _status(required),
            "threshold": T.EXT_SEASONALITY_QUESTION_MIN,
        },
        "disclaimer": "업종 비교 참고자료이며 94개 Feature Vector와 2축 점수에 넣지 않습니다.",
    }


def _case_bundle(case_id, pair, catalog, case_docs):
    features, aux = pair
    meta_by_code = {item["code"]: item for item in catalog}
    conversion, evidence_by_feature = _interview_conversion(case_id, features, meta_by_code)
    feature_rows = _feature_rows(features, catalog, evidence_by_feature)
    metadata = case_docs[case_id]
    return {
        "caseId": case_id,
        "ordinal": metadata["ordinal"],
        "title": metadata["title"],
        "summary": metadata["title"],
        "verificationPurpose": metadata["verificationPurpose"],
        "mock": True,
        "sourceSummary": _source_summary(feature_rows),
        "featureSummary": {
            "total": len(feature_rows),
            "valueCount": sum(1 for row in feature_rows if row["status"] == "VALUE"),
            "statusCounts": _status_counts(feature_rows),
        },
        "features": feature_rows,
        "triggers": _trigger_view(features, aux),
        "interviewConversion": conversion,
        "scorecard": _scorecard_view(features, aux, meta_by_code, evidence_by_feature),
        "cbContrast": _cb_contrast_view(
            case_id, features, aux, meta_by_code, evidence_by_feature
        ),
        "externalContext": _external_context_view(features, aux),
    }


def _score_item_map(axis):
    return {item["name"]: item for item in axis["items"]}


def _same_decline_comparison(case_by_id, built):
    ids = tuple(validate.CASES)
    rows = []
    for case_id in ids:
        features, aux = built[case_id]
        case = case_by_id[case_id]
        sales_item = _score_item_map(case["scorecard"]["improvement"])["매출 방향"]
        rows.append({
            "caseId": case_id,
            "title": case["title"],
            "salesGrowth3m": _json_safe(features["fin_sales_growth_3m"]),
            "salesDropDriver": _json_safe(aux["combined"]["sales_drop_driver"]),
            "transactionCountGrowth3m": _json_safe(features["ops_count_growth_3m"]),
            "averageTicketGrowth3m": _json_safe(features["ops_ticket_growth_3m"]),
            "operatingDayChange3m": _json_safe(features["biz_operating_day_change_3m"]),
            "salesPerOperatingDay3m": _json_safe(features["fin_sales_per_operating_day_3m"]),
            "currentSituationScore": case["scorecard"]["currentSituation"]["score"],
            "improvementScore": case["scorecard"]["improvement"]["score"],
            "salesDirection": {
                "points": sales_item["points"],
                "band": sales_item["band"],
                "note": sales_item["note"],
                "lineage": sales_item["lineage"],
            },
        })

    improvement_item_names = [item["name"] for item in case_by_id[ids[0]]["scorecard"]["improvement"]["items"]]
    differing = []
    for name in improvement_item_names:
        fingerprints = []
        for case_id in ids:
            item = _score_item_map(case_by_id[case_id]["scorecard"]["improvement"])[name]
            fingerprints.append((item["points"], item["excluded"], item["band"]))
        if len(set(fingerprints)) > 1:
            differing.append(name)

    growths = [row["salesGrowth3m"] for row in rows]
    current_scores = [row["currentSituationScore"] for row in rows]
    return {
        "title": "같은 -20% 매출 하락, 다른 평가",
        "caseIds": list(ids),
        "cases": rows,
        "invariants": {
            "salesGrowthEqual": validate.same(growths),
            "salesGrowth": growths[0],
            "currentSituationEqual": validate.same(current_scores),
            "onlyDifferingImprovementItems": differing,
        },
        "conclusion": "매출 감소율은 같아도 원인과 회복 맥락에 따라 평가 근거가 달라집니다.",
    }


def _build_without_interview(case_id):
    root = tempfile.mkdtemp(prefix="modeling_no_interview_")
    target = os.path.join(root, case_id)
    try:
        shutil.copytree(case_path(case_id), target)
        interview_path = os.path.join(target, "interview.json")
        if os.path.exists(interview_path):
            os.remove(interview_path)
        return build(target)
    finally:
        shutil.rmtree(root, ignore_errors=True)


def _numeric_delta(before, after):
    if not is_number(before) or not is_number(after):
        return None
    return float(after) - float(before)


def _interview_effect(case_by_id, built, catalog, case_id="case_operating_drop"):
    before_features, before_aux = _build_without_interview(case_id)
    after_features, after_aux = built[case_id]
    meta_by_code = {item["code"]: item for item in catalog}
    before_conversion, before_evidence = _interview_conversion(case_id + "_without_interview", before_features, meta_by_code)
    after_conversion, after_evidence = _interview_conversion(case_id, after_features, meta_by_code)
    before_score = _scorecard_view(before_features, before_aux, meta_by_code, before_evidence)
    after_score = _scorecard_view(after_features, after_aux, meta_by_code, after_evidence)

    changed_features = []
    for code in FEATURE_ORDER:
        if before_features[code] == after_features[code]:
            continue
        changed_features.append({
            "feature": code,
            "label": meta_by_code[code]["label"],
            "before": _json_safe(before_features[code]),
            "beforeStatus": _status(before_features[code]),
            "after": _json_safe(after_features[code]),
            "afterStatus": _status(after_features[code]),
            "source": meta_by_code[code]["source"],
            "metricLinks": [
                {"axis": axis_name, "item": item["name"]}
                for axis_name in ("currentSituation", "improvement")
                for item in after_score[axis_name]["items"]
                if any(link["feature"] == code for link in item["lineage"])
            ],
        })

    item_deltas = []
    for axis_name in ("currentSituation", "improvement"):
        before_items = _score_item_map(before_score[axis_name])
        after_items = _score_item_map(after_score[axis_name])
        for name, before_item in before_items.items():
            after_item = after_items[name]
            if (before_item["points"], before_item["excluded"], before_item["band"]) == (
                after_item["points"], after_item["excluded"], after_item["band"]
            ):
                continue
            item_deltas.append({
                "axis": axis_name,
                "item": name,
                "beforePoints": before_item["points"],
                "beforeExcluded": before_item["excluded"],
                "beforeBand": before_item["band"],
                "afterPoints": after_item["points"],
                "afterExcluded": after_item["excluded"],
                "afterBand": after_item["band"],
                "pointDelta": _numeric_delta(before_item["points"], after_item["points"]),
                "afterLineage": after_item["lineage"],
            })

    before_axis = before_score["improvement"]
    after_axis = after_score["improvement"]
    return {
        "caseId": case_id,
        "method": "REMOVE_INTERVIEW_JSON_AND_REBUILD_WITH_MODELING_BUILD",
        "before": {
            "label": "인터뷰 제거",
            "interviewPresent": False,
            "featureSummary": {
                "total": len(FEATURE_ORDER),
                "statusCounts": _status_counts(_feature_rows(before_features, catalog, {})),
            },
            "scorecard": before_score,
            "interviewConversion": before_conversion,
        },
        "after": {
            "label": "인터뷰 반영",
            "interviewPresent": after_conversion["interviewPresent"],
            "featureSummary": case_by_id[case_id]["featureSummary"],
            "scorecard": after_score,
            "interviewConversion": after_conversion,
        },
        "changedFeatures": changed_features,
        "changedScoreItems": item_deltas,
        "improvementScoreDelta": _numeric_delta(before_axis["score"], after_axis["score"]),
        "basisComparable": before_axis["itemsUsed"] == after_axis["itemsUsed"],
        "comparisonWarning": (
            "포함 항목 수가 다르면 환산 분모도 달라지므로 축 점수 차이를 단일 기여도로 해석하지 않습니다."
        ),
        "structuredInputsUnchanged": all(
            before_features[code] == after_features[code]
            for code in FEATURE_ORDER
            if SOURCE_OF[code] not in ("인터뷰", "조합")
        ),
    }


def _reevaluation_view(built):
    raw = reevaluate_compare()
    _, before_aux = built[raw["before_case"]]
    after_features, after_aux = built[raw["after_case"]]
    monthly = after_aux["card_sales"]["monthly"].tail(6)
    goal_months = set(after_aux["card_sales"]["recent_months"])
    return {
        "beforeCase": raw["before_case"],
        "afterCase": raw["after_case"],
        "goalFeature": raw["goal_feature"],
        "before": _json_safe(raw["before"]),
        "after": _json_safe(raw["after"]),
        "target": _json_safe(raw["target"]),
        "horizonDays": _json_safe(raw["horizon_days"]),
        "direction": _json_safe(raw.get("direction", MISSING)),
        "reached": _json_safe(raw["reached"]),
        "sameFeaturePipeline": True,
        "afterInterviewReused": bool(after_aux.get("has_interview")),
        "afterInterviewFeatureStatusCounts": dict(Counter(
            _status(after_features[code]) for code in INTERVIEW_FEATURE_NAMES
        )),
        "baselineAsOf": str(before_aux["reference_date"]),
        "followupAsOf": str(after_aux["reference_date"]),
        "recordSource": "card_sales.csv",
        "measurementRule": "결제가 1건 이상인 날짜를 월별로 집계하고 최근 3개월 평균을 계산",
        "monthlyRecords": [
            {
                "month": str(row.month),
                "sales": float(row.sales),
                "transactions": int(row.txn),
                "operatingDays": int(row.operating_days),
                "includedInGoal": row.month in goal_months,
            }
            for row in monthly.itertuples()
        ],
        "comparisonOperator": (
            "GREATER_THAN_OR_EQUAL" if raw.get("direction") == "INCREASE"
            else "LESS_THAN_OR_EQUAL" if raw.get("direction") == "DECREASE"
            else "NOT_EVALUATED"
        ),
        "disclaimer": (
            "과거 인터뷰 답을 재사용하지 않고 새 거래데이터에서 같은 피처를 계산합니다. "
            "인터뷰 당시 값과 목표의 방향을 고정한 뒤 같은 방향으로 목표 달성을 판정합니다."
        ),
    }


def _source_code_checksum():
    names = (
        "build.py", "scorecard.py", "triggers.py", "cb_contrast.py", "reevaluate.py",
        "thresholds.py", "common.py", "decompose.py", "external.py",
        os.path.join("features", "card_sales.py"),
        os.path.join("features", "account.py"),
        os.path.join("features", "card_spend.py"),
        os.path.join("features", "documents.py"),
        os.path.join("features", "cb.py"),
        os.path.join("features", "interview.py"),
        os.path.join("features", "combined.py"),
    )
    digest = hashlib.sha256()
    for name in names:
        path = os.path.join(os.path.dirname(__file__), name)
        digest.update(name.replace(os.sep, "/").encode("utf-8"))
        digest.update(b"\0")
        with open(path, "rb") as handle:
            digest.update(handle.read())
        digest.update(b"\0")
    return digest.hexdigest()


def _run_existing_validation(built):
    report = validate.Report()
    capture = io.StringIO()
    with contextlib.redirect_stdout(capture):
        validate.step1(report, built)
        validate.step2(report, built)
        validate.step3(report, built)
        validate.step4(report, built)
        validate.step5(report, built)
        validate.step6(report, built)
        validate.step7(report, built)
        validate.step11(report, built)
        validate.step12(report, built)
        validate.step13(report, built)
        validate.step14(report, built)
        passed = report.summary()

    per_step = []
    for step in sorted({row[0] for row in report.results}):
        rows = [row for row in report.results if row[0] == step]
        per_step.append({
            "step": step,
            "passed": sum(1 for row in rows if row[2]),
            "total": len(rows),
        })
    failed = [
        {"step": step, "name": name, "note": note}
        for step, name, ok, note in report.results if not ok
    ]
    return {
        "passed": passed,
        "checksPassed": sum(1 for row in report.results if row[2]),
        "checksTotal": len(report.results),
        "steps": per_step,
        "failed": failed,
    }


def _bundle_contract_errors(payload):
    errors = []
    catalog = payload.get("featureCatalog", [])
    if len(catalog) != 94:
        errors.append("featureCatalog가 94개가 아님")
    catalog_codes = [row.get("code") for row in catalog]
    if catalog_codes != list(FEATURE_ORDER):
        errors.append("featureCatalog 순서가 FEATURE_ORDER와 다름")
    if any(str(code).startswith("ext_") for code in catalog_codes):
        errors.append("94개 catalog에 ext_가 들어감")

    cases = payload.get("cases", [])
    if [case.get("caseId") for case in cases] != list(CASE_IDS):
        errors.append("case 순서나 ID가 ALL_CASES와 다름")
    for case in cases:
        if len(case.get("features", [])) != 94:
            errors.append("{} feature가 94개가 아님".format(case.get("caseId")))
        effect = case.get("modelingEffect", {})
        if effect.get("caseId") != case.get("caseId"):
            errors.append("{} 비교 결과가 다른 사례임".format(case.get("caseId")))
        if effect.get("structuredInputsUnchanged") is not True:
            errors.append("{} 비교의 정형 입력이 달라짐".format(case.get("caseId")))
        if effect.get("after", {}).get("scorecard") != case.get("scorecard"):
            errors.append("{} 비교 후 결과가 본 결과와 다름".format(case.get("caseId")))
        for mode in ("before", "after"):
            for axis_name in ("currentSituation", "improvement"):
                axis = effect.get(mode, {}).get("scorecard", {}).get(axis_name, {})
                items = axis.get("items", [])
                included = [item for item in items if not item["excluded"]]
                earned = sum(item["points"] for item in included)
                available = sum(item["maxPoints"] for item in included)
                accounting = axis.get("accounting", {})
                valid = (
                    len(items) == 5
                    and axis.get("itemsUsed") == len(included)
                    and accounting.get("earnedPoints") == earned
                    and accounting.get("availablePoints") == available
                    and accounting.get("isConfidence") is False
                    and accounting.get("coverageRatio") == len(included) / 5
                    and accounting.get("excludedItems") == [item["name"] for item in items if item["excluded"]]
                )
                if available:
                    valid = valid and is_number(axis.get("score")) and math.isclose(axis["score"], earned / available * 100)
                else:
                    valid = valid and axis.get("score") == MISSING
                for item in items:
                    contribution = item.get("normalizedContribution")
                    if item["excluded"]:
                        valid = valid and contribution is None
                    else:
                        valid = valid and is_number(contribution) and math.isclose(contribution, item["points"] / available * 100)
                if not valid:
                    errors.append("{} {} {} 점수 산식·반영 비율 불일치".format(case.get("caseId"), mode, axis_name))
        for axis in case.get("scorecard", {}).values():
            if not isinstance(axis, dict) or "items" not in axis:
                continue
            for item in axis["items"]:
                for lineage in item.get("lineage", []):
                    code = str(lineage.get("feature", ""))
                    if code.startswith("ext_") or lineage.get("source") == "EXTERNAL_BENCHMARK":
                        errors.append("{} score lineage에 외부값이 들어감".format(case.get("caseId")))
        ext = case.get("externalContext", {})
        if ext.get("includedInFeatureVector") is not False or ext.get("includedInScore") is not False:
            errors.append("{} 외부 context 경계가 false가 아님".format(case.get("caseId")))
    reevaluation = payload.get("reevaluation", {})
    rows = reevaluation.get("monthlyRecords", [])
    goal_rows = [row for row in rows if row.get("includedInGoal")]
    if (len(rows) != 6 or len(goal_rows) != T.RECENT_MONTHS
            or not math.isclose(sum(row["operatingDays"] for row in goal_rows) / T.RECENT_MONTHS,
                                reevaluation["after"])):
        errors.append("재평가 수행기록과 목표 변수 산출값 불일치")
    if any(row["month"] <= reevaluation.get("baselineAsOf", "")[:7] for row in rows):
        errors.append("수행기록에 최초 평가 이전 자료가 포함됨")
    return errors


def _validation_view(payload, built, run_existing_validation):
    detail = {
        case_id: triggers.evaluate_detail(*built[case_id]) for case_id in CASE_IDS
    }
    trigger_covered = [
        code for code in triggers.QUESTION_ORDER
        if any(detail[case_id][code]["fired"] for case_id in CASE_IDS)
        and any(not detail[case_id][code]["fired"] for case_id in CASE_IDS)
    ]
    total_bands = sum(len(bands) for bands in BANDS.values())
    contract_errors = _bundle_contract_errors(payload)
    existing = _run_existing_validation(built) if run_existing_validation else {
        "passed": None,
        "checksPassed": None,
        "checksTotal": None,
        "steps": [],
        "failed": [],
    }
    return {
        "nature": "DETERMINISTIC_RULE_BASED_PROTOTYPE",
        "mockData": True,
        "mockCaseCount": len(CASE_IDS),
        "realOutcomeRecordCount": 0,
        "trainedModel": False,
        "predictionValidated": False,
        "thresholds": "PROVISIONAL",
        "featureVector": {"passed": len(FEATURE_ORDER) == 94, "count": len(FEATURE_ORDER)},
        "conditionalQuestionRules": {
            "passed": len(trigger_covered) == len(triggers.QUESTION_ORDER),
            "covered": len(trigger_covered),
            "total": len(triggers.QUESTION_ORDER),
            "codes": trigger_covered,
        },
        "scorecardBands": {
            "executed": total_bands - len(validate.BANDS_WITHOUT_CASE),
            "total": total_bands,
            "unexecuted": len(validate.BANDS_WITHOUT_CASE),
            "unexecutedBands": [
                {"item": item, "band": band} for item, band in validate.BANDS_WITHOUT_CASE
            ],
        },
        "missingStates": list(STATES),
        "bundleContract": {
            "passed": not contract_errors,
            "errors": contract_errors,
        },
        "existingModelingValidation": existing,
        "limitations": [
            "mock 10개는 로직 검증 사례이며 통계 표본이나 성능 검증 데이터가 아닙니다.",
            "실제 연체·상환 outcome 0건이므로 예측력을 검증하지 않았습니다.",
            "scorecard threshold와 배점 일부는 임시값입니다.",
            "결측 상태는 변수에서 보존하지만 영업일 감소 사유 미확인의 매출 방향과 목표 미정의 계획 현실성은 현재 규칙에서 0점 구간입니다. 무응답의 불이익이 없다는 뜻이 아닙니다.",
            "인터뷰 자유 발화를 구조화 값으로 매핑하는 것은 Python modeling 밖의 책임입니다.",
            "재평가는 인터뷰 당시 값과 목표값으로 증가·감소 방향을 정한 뒤 같은 피처를 다시 계산합니다.",
        ],
        "sourceCodeChecksum": {
            "algorithm": "SHA-256",
            "value": _source_code_checksum(),
        },
    }


def _canonical_json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _attach_checksum(payload):
    canonical = _canonical_json(payload).encode("utf-8")
    payload["validation"]["checksum"] = {
        "algorithm": "SHA-256",
        "scope": "entire bundle before validation.checksum is attached",
        "value": hashlib.sha256(canonical).hexdigest(),
    }


def verify_checksum(payload):
    candidate = copy.deepcopy(payload)
    checksum = candidate.get("validation", {}).pop("checksum", None)
    if not isinstance(checksum, dict) or checksum.get("algorithm") != "SHA-256":
        return False
    expected = hashlib.sha256(_canonical_json(candidate).encode("utf-8")).hexdigest()
    return checksum.get("value") == expected


def build_bundle(run_existing_validation=True):
    """권위 Python 계산 결과로 10개 심사용 case bundle을 만든다."""
    _ensure_mock_cases()
    built = {case_id: build(case_path(case_id)) for case_id in CASE_IDS}
    catalog = _feature_catalog(built)
    case_docs = _case_doc_metadata()
    cases = [_case_bundle(case_id, built[case_id], catalog, case_docs) for case_id in CASE_IDS]
    case_by_id = {case["caseId"]: case for case in cases}
    effects = {case_id: _interview_effect(case_by_id, built, catalog, case_id) for case_id in CASE_IDS}
    for case in cases:
        case["modelingEffect"] = effects[case["caseId"]]

    source_counts = Counter(item["source"] for item in catalog)
    payload = {
        "schemaVersion": SCHEMA_VERSION,
        "model": {
            "version": MODEL_VERSION,
            "kind": "DETERMINISTIC_RULE_BASED_SCORECARD",
            "trainedModel": False,
            "prediction": False,
            "approvalDecision": False,
            "featureCount": len(catalog),
            "sourceCounts": [
                {
                    "source": source,
                    "sourceLabel": SOURCE_LABELS[source],
                    "featureCount": source_counts[source],
                }
                for source in SOURCE_CODES.values()
            ],
            "axes": [
                {"code": "CURRENT_SITUATION", "label": "현재 상황", "maxScore": 100},
                {"code": "IMPROVEMENT_POTENTIAL", "label": "개선가능성", "maxScore": 100},
            ],
            "authoritativeModules": [
                "modeling.build", "modeling.triggers", "modeling.scorecard",
                "modeling.cb_contrast", "modeling.reevaluate",
            ],
        },
        "featureCatalog": catalog,
        "cases": cases,
        "comparisons": {
            "sameSalesDecline": _same_decline_comparison(case_by_id, built),
            "interviewEffect": effects["case_operating_drop"],
        },
        "reevaluation": _reevaluation_view(built),
    }
    payload["validation"] = _validation_view(payload, built, run_existing_validation)
    if payload["validation"]["bundleContract"]["errors"]:
        raise AssertionError("web payload 계약 실패: {}".format(
            payload["validation"]["bundleContract"]["errors"]
        ))
    if run_existing_validation and not payload["validation"]["existingModelingValidation"]["passed"]:
        raise AssertionError("기존 modeling.validate 검증이 실패했습니다")
    _attach_checksum(payload)
    return payload


def _write_output(path, payload):
    target = os.path.abspath(path)
    parent = os.path.dirname(target)
    if parent:
        os.makedirs(parent, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".modeling-web-", suffix=".json", dir=parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, target)
    except Exception:
        try:
            os.remove(temporary)
        except OSError:
            pass
        raise


def main(argv=None):
    parser = argparse.ArgumentParser(description="웹 심사용 modeling_web_v1 JSON bundle 생성")
    parser.add_argument("--output", help="원자적으로 기록할 JSON 경로")
    parser.add_argument("--stdout", action="store_true", help="JSON을 stdout에 출력")
    parser.add_argument(
        "--skip-existing-validation",
        action="store_true",
        help="빠른 개발용. 기존 전체 validate 결과 실행을 건너뜀",
    )
    args = parser.parse_args(argv)
    if not args.output and not args.stdout:
        parser.error("--output 또는 --stdout 중 하나 이상이 필요합니다")

    payload = build_bundle(run_existing_validation=not args.skip_existing_validation)
    if args.output:
        _write_output(args.output, payload)
    if args.stdout:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
