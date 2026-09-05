"""CB 연계 피처 1개.

CB 점수, 등급, 상위 비율, 연체가능성, 심사 의견은 피처로 쓰지 않고 화면에 그대로
표시한다. CB 점수는 수정하지 않는다.
"""

from ..common import ratio

FEATURE_NAMES = ("crd_debt_payment_to_sales_ratio",)


def compute(cb, sales_avg_3m):
    return {
        "crd_debt_payment_to_sales_ratio": ratio(cb.get("monthly_debt_payment"), sales_avg_3m),
    }
