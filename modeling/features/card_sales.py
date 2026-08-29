"""카드매출 12개월 피처 18개."""

import numpy as np
import pandas as pd

from .. import thresholds as T
from ..common import (MISSING, growth, is_number, month_period, ratio, slope,
                      window_means, window_sums)

FEATURE_NAMES = (
    "fin_sales_avg_3m",
    "fin_sales_avg_12m",
    "fin_sales_growth_3m",
    "fin_sales_trend_slope_6m",
    "biz_sales_cv_6m",
    "biz_sales_recovery_from_trough",
    "biz_sales_drawdown_from_peak",
    "biz_zero_sales_month_count_12m",
    "biz_consecutive_active_months",
    "biz_recent_activity_flag",
    "biz_observed_month_count",
    "ops_transaction_count_avg_3m",
    "ops_avg_ticket_3m",
    "ops_count_growth_3m",
    "ops_ticket_growth_3m",
    "biz_operating_day_count_avg_3m",
    "fin_sales_per_operating_day_3m",
    "biz_operating_day_change_3m",
)


def monthly(df):
    """일별 카드매출을 월별로 접는다. 영업일은 결제가 한 건이라도 있는 날."""
    d = df.copy()
    d["date"] = pd.to_datetime(d["date"])
    d["month"] = month_period(d["date"])
    d["operating"] = (d["txn_count"] > 0).astype(int)
    d["weekday_sales"] = np.where(
        d["date"].dt.dayofweek.isin(T.WEEKDAY_DOW), d["sales_amount"], 0
    )
    grouped = d.groupby("month", as_index=False).agg(
        sales=("sales_amount", "sum"),
        txn=("txn_count", "sum"),
        delivery=("delivery_amount", "sum"),
        operating_days=("operating", "sum"),
        weekday_sales=("weekday_sales", "sum"),
    )
    return grouped.sort_values("month").reset_index(drop=True)


def compute(df):
    """피처 18개와 다른 모듈이 쓰는 보조값을 낸다."""
    m = monthly(df)
    n = len(m)
    sales = m["sales"].to_numpy(dtype=float)

    recent_sales_mean, prior_sales_mean = window_means(m, "sales", T.RECENT_MONTHS, T.PRIOR_MONTHS)
    recent_sales_sum, prior_sales_sum = window_sums(m, "sales", T.RECENT_MONTHS, T.PRIOR_MONTHS)
    recent_txn_sum, prior_txn_sum = window_sums(m, "txn", T.RECENT_MONTHS, T.PRIOR_MONTHS)
    recent_txn_mean, prior_txn_mean = window_means(m, "txn", T.RECENT_MONTHS, T.PRIOR_MONTHS)
    recent_days_sum, prior_days_sum = window_sums(m, "operating_days", T.RECENT_MONTHS, T.PRIOR_MONTHS)
    recent_days_mean, prior_days_mean = window_means(m, "operating_days", T.RECENT_MONTHS, T.PRIOR_MONTHS)

    recent_ticket = ratio(recent_sales_sum, recent_txn_sum)
    prior_ticket = ratio(prior_sales_sum, prior_txn_sum)
    recent_per_day = ratio(recent_sales_sum, recent_days_sum)
    prior_per_day = ratio(prior_sales_sum, prior_days_sum)

    trend_window = sales[-T.TREND_MONTHS:] if n >= 2 else []
    cv = MISSING
    if n >= T.TREND_MONTHS:
        window = sales[-T.TREND_MONTHS:]
        mean = float(window.mean())
        cv = ratio(float(window.std(ddof=1)), mean)

    features = {
        "fin_sales_avg_3m": recent_sales_mean,
        "fin_sales_avg_12m": float(sales.mean()) if n else MISSING,
        "fin_sales_growth_3m": growth(recent_sales_mean, prior_sales_mean),
        "fin_sales_trend_slope_6m": slope(trend_window),
        "biz_sales_cv_6m": cv,
        "biz_sales_recovery_from_trough": growth(sales[-1], sales.min()) if n else MISSING,
        "biz_sales_drawdown_from_peak": growth(sales[-1], sales.max()) if n else MISSING,
        "biz_zero_sales_month_count_12m": int((sales == 0).sum()) if n else MISSING,
        "biz_consecutive_active_months": _trailing_active_months(sales),
        "biz_recent_activity_flag": bool(sales[-1] > 0) if n else MISSING,
        "biz_observed_month_count": n,
        "ops_transaction_count_avg_3m": recent_txn_mean,
        "ops_avg_ticket_3m": recent_ticket,
        "ops_count_growth_3m": growth(recent_txn_mean, prior_txn_mean),
        "ops_ticket_growth_3m": growth(recent_ticket, prior_ticket),
        "biz_operating_day_count_avg_3m": recent_days_mean,
        "fin_sales_per_operating_day_3m": recent_per_day,
        "biz_operating_day_change_3m": growth(recent_days_mean, prior_days_mean),
    }

    aux = {
        "monthly": m,
        "recent_months": list(m["month"].tail(T.RECENT_MONTHS)),
        "sales_per_operating_day_growth_3m": growth(recent_per_day, prior_per_day),
        "delivery_share_recent": _delivery_share(m, T.TRIGGER_DELIVERY_WINDOW_MONTHS),
        "card_sales_total_12m": float(sales.sum()) if n else MISSING,
        "recent_sales_sum": recent_sales_sum,
        "peak_calendar_months": _peak_calendar_months(m),
        "weekday_share_recent": _weekday_share(m, T.RECENT_MONTHS, 0),
        "weekday_share_prior": _weekday_share(m, T.PRIOR_MONTHS, T.RECENT_MONTHS),
    }
    return features, aux


def _trailing_active_months(sales):
    """끝에서부터 매출이 0이 아닌 달이 몇 달 이어졌는지."""
    if len(sales) == 0:
        return MISSING
    count = 0
    for value in sales[::-1]:
        if value <= 0:
            break
        count += 1
    return count


def _delivery_share(m, months):
    if len(m) < months:
        return MISSING
    tail = m.tail(months)
    return ratio(float(tail["delivery"].sum()), float(tail["sales"].sum()))


def _weekday_share(m, months, offset):
    """구간의 주중 매출 비중. offset은 끝에서 몇 달을 건너뛸지."""
    end = len(m) - offset
    start = end - months
    if start < 0:
        return MISSING
    window = m.iloc[start:end]
    return ratio(float(window["weekday_sales"].sum()), float(window["sales"].sum()))


def _peak_calendar_months(m):
    """실제 매출 상위 달의 달 번호. 같은 값이면 이른 달을 앞에 둔다.

    두 경우에 MISSING을 낸다. 상위 달 평균이 전체 평균에 견줘 충분히 높지 않을 때,
    그리고 계절로 몰린 폭이 12개월 추세로 설명되는 폭보다 크지 않을 때다. 앞은 평탄한
    매출에서 잔흔들림을 성수기로 읽는 것을 막고, 뒤는 내내 줄어든 가게의 덜 나빴던
    과거를 성수기로 읽는 것을 막는다. 12개월로는 계절과 추세를 구분할 수 없으므로
    구분이 안 되는 구간에서는 대조하지 않는다.
    """
    if len(m) == 0:
        return MISSING
    sales = m["sales"].to_numpy(dtype=float)
    overall = float(sales.mean())
    if overall <= 0:
        return MISSING

    ordered = m.sort_values(["sales", "month"], ascending=[False, True])
    top = ordered.head(T.SEASONALITY_TOP_MONTHS)
    peak_excess = float(top["sales"].mean()) / overall - 1.0
    if peak_excess + 1.0 < T.SEASONALITY_PEAK_RATIO:
        return MISSING

    trend = slope(sales)
    trend_span = abs(trend) * len(sales) / overall if is_number(trend) else 0.0
    if peak_excess < trend_span * T.SEASONALITY_PEAK_OVER_TREND:
        return MISSING
    return sorted({int(p.month) for p in top["month"]})
