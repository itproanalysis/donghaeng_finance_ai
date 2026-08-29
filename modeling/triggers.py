"""조건부 질문 판정.

거래 데이터가 조건에 걸리면 추가로 물어야 할 질문 코드를 낸다. 조건은 코드로 고정해
같은 데이터면 언제나 같은 질문이 나온다. 경계값은 thresholds.py에 있다.

배달 비중만 피처가 아니라 카드매출 원본에서 나오는 값이라 build.py의 보조값을
같이 받는다.
"""

import os
import sys

from . import thresholds as T
from .common import is_number

Q_OPERATING_DAY_DROP = "Q_OPERATING_DAY_DROP"
Q_FIXED_COST_INCREASE = "Q_FIXED_COST_INCREASE"
Q_LOW_BALANCE = "Q_LOW_BALANCE"
Q_PURCHASE_INCREASE = "Q_PURCHASE_INCREASE"
Q_DELIVERY_SHARE = "Q_DELIVERY_SHARE"
Q_WEEKDAY_SHARE_CHANGE = "Q_WEEKDAY_SHARE_CHANGE"

QUESTION_ORDER = (
    Q_OPERATING_DAY_DROP,
    Q_FIXED_COST_INCREASE,
    Q_LOW_BALANCE,
    Q_PURCHASE_INCREASE,
    Q_DELIVERY_SHARE,
    Q_WEEKDAY_SHARE_CHANGE,
)

# 질문 하나가 채우는 피처
FILLS = {
    Q_OPERATING_DAY_DROP: ("own_operating_day_drop_reason",
                           "own_operating_day_drop_resolved_flag"),
    Q_FIXED_COST_INCREASE: ("own_fixed_cost_increase_reason",),
    Q_LOW_BALANCE: ("own_low_balance_coping_method",),
    Q_PURCHASE_INCREASE: ("own_purchase_increase_reason",),
    Q_DELIVERY_SHARE: ("ops_platform_fee_ratio",),
    Q_WEEKDAY_SHARE_CHANGE: ("biz_hall_customer_decline_flag",),
}


def evaluate_detail(features, aux):
    """질문마다 (나오는지 여부, 본 값)을 낸다."""
    card_aux = aux.get("card_sales", {})
    checks = {
        Q_OPERATING_DAY_DROP: (features.get("biz_operating_day_change_3m"),
                               lambda v: v <= T.TRIGGER_OPERATING_DAY_CHANGE),
        Q_FIXED_COST_INCREASE: (features.get("fin_recurring_outflow_growth_3m"),
                                lambda v: v >= T.TRIGGER_RECURRING_OUTFLOW_GROWTH),
        Q_LOW_BALANCE: (features.get("fin_low_balance_day_count_3m"),
                        lambda v: v >= T.TRIGGER_LOW_BALANCE_DAY_COUNT),
        Q_PURCHASE_INCREASE: (features.get("fin_purchase_spend_growth_3m"),
                              lambda v: v >= T.TRIGGER_PURCHASE_SPEND_GROWTH),
        Q_DELIVERY_SHARE: (card_aux.get("delivery_share_recent"),
                           lambda v: v >= T.TRIGGER_DELIVERY_SHARE),
        Q_WEEKDAY_SHARE_CHANGE: (features.get("ops_weekday_sales_share_change"),
                                 lambda v: abs(v) >= T.TRIGGER_WEEKDAY_SHARE_CHANGE),
    }
    detail = {}
    for code in QUESTION_ORDER:
        value, test = checks[code]
        detail[code] = {"fired": bool(is_number(value) and test(value)), "value": value}
    return detail


def evaluate(features, aux):
    """물어야 할 질문 코드 목록."""
    detail = evaluate_detail(features, aux)
    return [code for code in QUESTION_ORDER if detail[code]["fired"]]


def main():
    from .build import MOCK_DIR, build, case_path

    case_ids = sys.argv[1:] or sorted(os.listdir(MOCK_DIR))
    for case_id in case_ids:
        features, aux = build(case_path(case_id))
        detail = evaluate_detail(features, aux)
        fired = [c for c in QUESTION_ORDER if detail[c]["fired"]]
        print("{}  추가 질문 {}".format(case_id, fired if fired else "없음"))
        for code in QUESTION_ORDER:
            value = detail[code]["value"]
            shown = "{:,.4g}".format(value) if isinstance(value, float) else value
            print("  {:<24} {:<5} {}".format(code, "O" if detail[code]["fired"] else ".", shown))
        print()


if __name__ == "__main__":
    main()
