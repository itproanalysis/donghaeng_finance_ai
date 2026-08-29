"""2축 점수. 규칙은 docs/SCORECARD.md 그대로이고 구간 경계는 thresholds.py에서 읽는다.

예측이 아니라 규칙 합산이며 심사 참고자료다. 승인, 거절 판단에 쓰지 않는다.
계산 안 된 항목은 0점이 아니라 제외하고 남은 항목 만점 합으로 100점 환산한다.
"""

import os
import sys

from . import thresholds as T
from .common import MISSING, NOT_APPLICABLE, UNDECIDED, is_number, is_state
from .decompose import COUNT, OPERATING_DAY, TICKET

EXCLUDED = None

MISALIGNED_SUFFIX = "/ 목표가 데이터와 어긋나 한 구간 아래"

EXCLUDED_BAND = "제외"

BANDS = {
    "매출 대비 남는 비율": ("10% 이상", "0~10%", "적자", EXCLUDED_BAND),
    "흑자월 비율": ("6/6개월", "4~5개월", "2~3개월", "0~1개월", EXCLUDED_BAND),
    "잔액 부족일": ("0일", "1~2일", "3~5일", "6일 이상", EXCLUDED_BAND),
    "매출 대비 상환 부담": ("10% 미만", "10~20%", "20~30%", "30% 이상", EXCLUDED_BAND),
    "버틸 수 있는 일수": ("60일 이상", "30~59일", "15~29일", "15일 미만", EXCLUDED_BAND),
    "매출 방향": ("+5% 이상", "-5%~+5% 유지", "하락, 사유 확인, 해소됨",
                "하락, 사유 확인, 진행 중", "하락, 사유 없음", EXCLUDED_BAND),
    "저점 회복": ("고점 대비 하락 10% 이내", "회복 중", "저점 정체", "지금이 제일 낮음",
               EXCLUDED_BAND),
    "잡혀 있는 계약": ("8주 이상, 계약금 확인", "4주 이상, 계약금 미확인", "4주 미만",
                 "없음", "해당 없음 업종", EXCLUDED_BAND),
    "비용 줄일 여지": ("30% 이상 조정 가능", "15~30%", "5~15%",
                  "5% 이하, 반복 출금이 거의 전부", EXCLUDED_BAND),
    "계획의 현실성": ("배수 1.5배 이하, 예산 1배 이하", "배수 2배 초과 또는 예산 부담 큼",
                 "배수 1.5배 이하, 예산 1배 이하 " + MISALIGNED_SUFFIX,
                 "배수 2배 초과 또는 예산 부담 큼 " + MISALIGNED_SUFFIX,
                 "목표 안 정함", EXCLUDED_BAND),
}


def _item(name, points, band, note=""):
    """항목 하나. points가 EXCLUDED면 산출에서 빠진 것이고 excluded로도 표시한다."""
    return {"name": name, "points": points, "excluded": points is EXCLUDED,
            "band": band, "note": note}


def current_situation(features):
    """축 1. 지금 버틸 수 있는 상태인지. 전부 거래 데이터와 CB에서 계산."""
    items = [
        _band_item("매출 대비 남는 비율", features.get("fin_cashflow_to_sales_ratio"),
                   _cashflow_to_sales),
        _band_item("흑자월 비율", features.get("fin_net_cashflow_positive_month_ratio_6m"),
                   _positive_months),
        _band_item("잔액 부족일", features.get("fin_low_balance_day_count_3m"),
                   _low_balance),
        _band_item("매출 대비 상환 부담", features.get("crd_debt_payment_to_sales_ratio"),
                   _debt_burden),
        _band_item("버틸 수 있는 일수", features.get("fin_cash_buffer_days_est"),
                   _cash_buffer),
    ]
    return _total(items)


def improvement(features, aux):
    """축 2. 나아질 여지가 있고 그 방향으로 가고 있는지. 인터뷰가 점수를 바꾸는 축."""
    cv = features.get("biz_sales_cv_6m")
    volatile = is_number(cv) and cv >= T.SC_SALES_CV_SUSPEND
    suspend_note = "매출 오르내림이 커서 방향 판단 제외" if volatile else ""

    if volatile:
        sales_item = _item("매출 방향", EXCLUDED, "제외", suspend_note)
        trough_item = _item("저점 회복", EXCLUDED, "제외", suspend_note)
    else:
        sales_item = _sales_direction(features, aux)
        trough_item = _trough_recovery(features, aux)

    items = [
        sales_item,
        trough_item,
        _confirmed_orders(features),
        _band_item("비용 줄일 여지", features.get("imp_cost_adjustment_headroom"),
                   _cost_headroom),
        _plan_realism(features),
    ]
    result = _total(items)
    result["note"] = suspend_note
    return result


def score(features, aux):
    return {
        "current_situation": current_situation(features),
        "improvement": improvement(features, aux),
    }


def _total(items):
    included = [i for i in items if i["points"] is not EXCLUDED]
    if not included:
        return {"score": MISSING, "items": items, "items_used": 0, "items_total": len(items),
                "basis": "산출 가능한 항목 없음", "note": ""}
    earned = sum(i["points"] for i in included)
    full = T.AXIS_ITEM_POINTS * len(included)
    return {
        "score": earned / full * 100.0,
        "items": items,
        "items_used": len(included),
        "items_total": len(items),
        "basis": "{}항목 중 {}항목으로 산출".format(len(items), len(included)),
        "note": "",
    }


def _band_item(name, value, bander):
    if not is_number(value):
        return _item(name, EXCLUDED, "제외", "재료 {}".format(value if is_state(value) else MISSING))
    points, band = bander(float(value))
    return _item(name, points, band)


def _cashflow_to_sales(v):
    low, high = T.SC_CASHFLOW_TO_SALES
    if v >= high:
        return 20, "10% 이상"
    if v >= low:
        return 12, "0~10%"
    return 0, "적자"


def _positive_months(v):
    low, mid, full = T.SC_POSITIVE_MONTH_RATIO
    if v >= full:
        return 20, "6/6개월"
    if v >= mid:
        return 14, "4~5개월"
    if v >= low:
        return 7, "2~3개월"
    return 0, "0~1개월"


def _low_balance(v):
    per_month = v / T.RECENT_MONTHS
    zero, low, mid = T.SC_LOW_BALANCE_DAYS_PER_MONTH
    if per_month <= zero:
        return 20, "0일"
    if per_month <= low:
        return 12, "1~2일"
    if per_month <= mid:
        return 6, "3~5일"
    return 0, "6일 이상"


def _debt_burden(v):
    low, mid, high = T.SC_DEBT_TO_SALES
    if v < low:
        return 20, "10% 미만"
    if v < mid:
        return 12, "10~20%"
    if v < high:
        return 6, "20~30%"
    return 0, "30% 이상"


def _cash_buffer(v):
    short, mid, long = T.SC_CASH_BUFFER_DAYS
    if v >= long:
        return 20, "60일 이상"
    if v >= mid:
        return 12, "30~59일"
    if v >= short:
        return 6, "15~29일"
    return 0, "15일 미만"


def _cost_headroom(v):
    if v <= T.SC_COST_HEADROOM_ALL_RECURRING:
        return 0, "5% 이하, 반복 출금이 거의 전부"
    low, high = T.SC_COST_HEADROOM
    if v >= high:
        return 20, "30% 이상 조정 가능"
    if v >= low:
        return 12, "15~30%"
    return 4, "5~15%"


def _sales_direction(features, aux):
    """매출 증가율에 원인 구분과 추가 질문 답을 붙여 구간을 정한다."""
    growth = features.get("fin_sales_growth_3m")
    if not is_number(growth):
        return _item("매출 방향", EXCLUDED, "제외", "재료 없음")
    if growth >= T.SC_SALES_GROWTH_UP:
        return _item("매출 방향", 20, "+5% 이상")
    if growth >= T.SC_SALES_GROWTH_FLAT:
        return _item("매출 방향", 12, "-5%~+5% 유지")

    driver = aux["combined"]["sales_drop_driver"]
    if driver == OPERATING_DAY:
        reason = features.get("own_operating_day_drop_reason")
        resolved = features.get("own_operating_day_drop_resolved_flag")
        if reason in T.RESOLVABLE_OPERATING_DAY_REASONS:
            confirmed, note = _resolution_confirmed(features, reason, resolved)
            if confirmed:
                return _item("매출 방향", 10, "하락, 사유 확인, 해소됨",
                             "원인: 영업일 감소 / {}{}".format(reason, note))
            return _item("매출 방향", 4, "하락, 사유 확인, 진행 중",
                         "원인: 영업일 감소 / {}{}".format(reason, note))
        if reason in T.ONGOING_OPERATING_DAY_REASONS:
            return _item("매출 방향", 4, "하락, 사유 확인, 진행 중",
                         "원인: 영업일 감소 / {}".format(reason))
        return _item("매출 방향", 0, "하락, 사유 없음", "원인: 영업일 감소 / 무응답")
    if driver in (COUNT, TICKET):
        label = "원인: 손님 감소" if driver == COUNT else "원인: 1인당 결제액 하락"
        return _item("매출 방향", 4, "하락, 사유 확인, 진행 중", label)
    return _item("매출 방향", 0, "하락, 사유 없음", "분해 불가")


def _resolution_confirmed(features, reason, resolved):
    """해소됐다는 답을 받아들일지. 대조할 데이터가 있는 사유는 대조한다.

    일손 부족이 풀렸다면 사람을 새로 썼다는 뜻이므로 반복 출금이 늘어 있어야 한다.
    진술만으로 6점이 달라지는 자리라 데이터에 흔적이 없으면 진행 중으로 둔다.
    건강과 가족 일은 거래 데이터에 남지 않아 진술 그대로 받는다.
    """
    if resolved is not True:
        return False, ""
    if reason != T.DATA_CHECKED_OPERATING_DAY_REASON:
        return True, ""
    growth = features.get("fin_recurring_outflow_growth_3m")
    if is_number(growth) and growth >= T.RESOLVED_LABOR_RECURRING_GROWTH_MIN:
        return True, " / 반복 출금 {:+.0%}로 확인".format(growth)
    shown = "{:+.0%}".format(growth) if is_number(growth) else growth
    return False, " / 반복 출금 {} 로 확인 안 됨".format(shown)


def _trough_recovery(features, aux):
    drawdown = features.get("biz_sales_drawdown_from_peak")
    recovery = features.get("biz_sales_recovery_from_trough")
    if not is_number(drawdown) or not is_number(recovery):
        return _item("저점 회복", EXCLUDED, "제외", "재료 없음")
    if abs(drawdown) <= T.SC_DRAWDOWN_NEAR_PEAK:
        return _item("저점 회복", 20, "고점 대비 하락 10% 이내")
    if recovery >= T.SC_RECOVERY_IN_PROGRESS:
        return _item("저점 회복", 14, "회복 중")
    if _making_new_low(aux):
        return _item("저점 회복", 0, "지금이 제일 낮음")
    return _item("저점 회복", 4, "저점 정체")


def _making_new_low(aux):
    """마지막 달이 그 전 모든 달보다 낮은지."""
    sales = aux["card_sales"]["monthly"]["sales"].to_numpy(dtype=float)
    if len(sales) < 2:
        return False
    return bool(sales[-1] < sales[:-1].min())


def _confirmed_orders(features):
    weeks = features.get("own_booking_coverage_weeks")
    deposit = features.get("own_confirmed_order_deposit_flag")
    if weeks == NOT_APPLICABLE:
        return _item("잡혀 있는 계약", EXCLUDED, "해당 없음 업종")
    if not is_number(weeks):
        return _item("잡혀 있는 계약", EXCLUDED, "제외", "재료 {}".format(weeks))
    if weeks <= 0:
        return _item("잡혀 있는 계약", 0, "없음")
    if weeks >= 8 and deposit is True:
        return _item("잡혀 있는 계약", 20, "8주 이상, 계약금 확인")
    # 구간은 몇 주치인지로 정하고 계약금은 만점 조건에서만 본다. 계약금을 조건에
    # 먼저 두면 계약금을 받은 쪽이 못 받은 쪽보다 낮은 구간으로 내려간다
    if weeks >= 4:
        return _item("잡혀 있는 계약", 12, "4주 이상, 계약금 미확인")
    return _item("잡혀 있는 계약", 6, "4주 미만")


def _plan_realism(features):
    """목표 배수, 예산 부담, 목표와 데이터의 어긋남으로 구간을 정한다."""
    target = features.get("own_goal_target_value")
    if target == UNDECIDED:
        return _item("계획의 현실성", 0, "목표 안 정함")
    if is_state(target):
        return _item("계획의 현실성", EXCLUDED, "제외", "재료 {}".format(target))

    stretch = features.get("own_goal_stretch_ratio")
    budget = features.get("own_plan_budget_to_cashflow_ratio")
    if not is_number(stretch) or not is_number(budget):
        return _item("계획의 현실성", EXCLUDED, "제외", "목표 배수 또는 예산 부담 계산 불가")

    if stretch <= T.SC_GOAL_STRETCH_OK and budget <= T.SC_PLAN_BUDGET_OK:
        points, band = 20, "배수 1.5배 이하, 예산 1배 이하"
    else:
        points, band = 8, "배수 2배 초과 또는 예산 부담 큼"

    alignment = features.get("imp_goal_data_alignment")
    misaligned = isinstance(alignment, dict) and alignment["value"] < 0
    if misaligned:
        points = 8 if points == 20 else 0
        band = band + " " + MISALIGNED_SUFFIX
    return _item("계획의 현실성", points, band,
                 "배수 {:.3f} 예산 {:.3f}".format(stretch, budget))


def payload(case_id):
    """앱이 그대로 받는 dict. 문장은 만들지 않는다."""
    from .build import build, case_path

    features, aux = build(case_path(case_id))
    result = score(features, aux)
    result["case_id"] = case_id
    return result


def main():
    import argparse
    import json

    from .build import MOCK_DIR

    parser = argparse.ArgumentParser(description="2축 점수")
    parser.add_argument("case_ids", nargs="*")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    case_ids = args.case_ids or sorted(os.listdir(MOCK_DIR))
    if args.json:
        out = [payload(case_id) for case_id in case_ids]
        print(json.dumps(out if len(out) > 1 else out[0], ensure_ascii=False, indent=2))
        return

    for case_id in case_ids:
        result = payload(case_id)
        print(case_id)
        for axis_key, axis_name in (("current_situation", "현재 상황"),
                                    ("improvement", "개선가능성")):
            axis = result[axis_key]
            value = axis["score"]
            shown = "{:.1f}".format(value) if is_number(value) else value
            print("  {} {:>6}점   {}{}".format(
                axis_name, shown, axis["basis"],
                "  {}".format(axis["note"]) if axis.get("note") else ""))
            for item in axis["items"]:
                points = "제외" if item["points"] is EXCLUDED else "{:>2}점".format(item["points"])
                print("    {:<16} {:>4}  {:<28} {}".format(
                    item["name"], points, item["band"], item["note"]))
        print()


if __name__ == "__main__":
    main()
