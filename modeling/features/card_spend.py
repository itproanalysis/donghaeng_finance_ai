"""카드 사용내역 12개월 피처 5개."""

import pandas as pd

from .. import thresholds as T
from ..common import MISSING, growth, month_period, ratio, window_means

FEATURE_NAMES = (
    "fin_business_spend_ratio",
    "fin_purchase_spend_growth_3m",
    "fin_spend_to_sales_ratio_12m",
    "fin_marketing_spend_flag",
    "own_prior_action_count",
)

# 사업용으로 보는 카테고리. personal만 빼면 나머지가 사업용
BUSINESS_CATEGORIES = ("purchase", "marketing", "business")


def compute(df, card_sales_total_12m):
    d = df.copy()
    d["date"] = pd.to_datetime(d["date"])
    d["month"] = month_period(d["date"])

    total = float(d["amount"].sum())
    business = float(d[d["category"].isin(BUSINESS_CATEGORIES)]["amount"].sum())
    marketing = d[d["category"] == "marketing"]

    purchase_monthly = (d[d["category"] == "purchase"]
                        .groupby("month", as_index=False)["amount"].sum()
                        .sort_values("month")
                        .reset_index(drop=True))
    if len(purchase_monthly):
        recent, prior = window_means(purchase_monthly, "amount", T.RECENT_MONTHS, T.PRIOR_MONTHS)
    else:
        recent, prior = MISSING, MISSING

    return {
        "fin_business_spend_ratio": ratio(business, total),
        "fin_purchase_spend_growth_3m": growth(recent, prior),
        "fin_spend_to_sales_ratio_12m": ratio(total, card_sales_total_12m),
        "fin_marketing_spend_flag": bool(len(marketing) > 0),
        "own_prior_action_count": int(len(marketing)),
    }
