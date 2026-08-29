"""계좌 입출금 6개월 피처 18개."""

import numpy as np
import pandas as pd

from .. import thresholds as T
from ..common import MISSING, growth, is_number, month_period, ratio, slope, window_means

FEATURE_NAMES = (
    "fin_avg_month_end_balance_3m",
    "fin_min_month_end_balance_6m",
    "fin_month_end_balance_growth_3m",
    "fin_cash_inflow_avg_3m",
    "fin_cash_outflow_avg_3m",
    "fin_net_cashflow_avg_3m",
    "fin_net_cashflow_positive_month_ratio_6m",
    "fin_cashflow_trend_slope_6m",
    "fin_cashflow_deficit_month_count_6m",
    "fin_cash_buffer_days_est",
    "fin_cashflow_to_sales_ratio",
    "fin_recurring_outflow_avg_3m",
    "fin_recurring_outflow_ratio",
    "fin_recurring_outflow_count",
    "fin_recurring_outflow_growth_3m",
    "fin_min_daily_balance_3m",
    "fin_low_balance_day_count_3m",
    "fin_balance_volatility_3m",
)


def cash_buffer_days(month_end_balance, daily_outflow):
    """지금 잔액으로 며칠 버티는지. 잔액이 0 이하면 이미 못 버티는 상태라 0일이다."""
    if is_number(month_end_balance) and month_end_balance <= 0:
        return 0.0
    return ratio(month_end_balance, daily_outflow)


def detect_recurring(tx):
    """OUT 거래를 (날짜 ±3일, 금액 ±10%) 묶음으로 만든다.

    한 묶음에 한 달치는 하나만 담고, 연속한 달에 3번 이상 이어져야 고정 지출로 본다.
    FEATURE_LIST가 "매달 비슷한 날짜에 비슷한 금액이 3번 이상"이라고 적어 연속으로
    읽었다. 아무 세 달이나 걸리면 되게 하면 변동 지출까지 묶음이 된다.

    묶는 순서는 금액이 아니라 묶음의 질로 정한다. 오래 이어지고 금액이 덜 벌어진
    묶음을 먼저 확정한다. 금액 큰 것부터 잡으면 변동 지출이 임대료 묶음을 흩어 놓는다.
    받는 사람 정보는 쓰지 않는다.
    """
    out = tx[tx["direction"] == "OUT"].copy()
    if out.empty:
        return []
    out["dom"] = out["date"].dt.day
    out["ym"] = month_period(out["date"])

    groups = []
    used = set()
    while True:
        best = None
        available = out[~out.index.isin(used)]
        for anchor in available.index:
            run, spread = _candidate_group(out, used, anchor)
            if len(run) < T.RECURRING_MIN_OCCURRENCES:
                continue
            score = (len(run), -spread)
            if best is None or score > best[0]:
                best = (score, run)
        if best is None:
            break
        groups.append(best[1])
        used.update(best[1])
    return groups


def _candidate_group(out, used, anchor):
    """기준 거래 하나가 만들 수 있는 묶음과 그 묶음의 금액 벌어짐."""
    amount = float(out.at[anchor, "amount"])
    dom = int(out.at[anchor, "dom"])
    low = amount * (1.0 - T.RECURRING_AMOUNT_TOLERANCE)
    high = amount * (1.0 + T.RECURRING_AMOUNT_TOLERANCE)
    candidates = out[
        (~out.index.isin(used))
        & out["amount"].between(low, high)
        & ((out["dom"] - dom).abs() <= T.RECURRING_DAY_TOLERANCE)
    ].copy()
    if candidates.empty:
        return [], 0.0
    candidates["gap"] = (candidates["amount"] - amount).abs()
    picked = (candidates.sort_values(["ym", "gap"])
              .groupby("ym", as_index=False, group_keys=False)
              .head(1))
    run = _longest_consecutive_run(picked, anchor)
    if len(run) < T.RECURRING_MIN_OCCURRENCES:
        return run, 0.0
    values = out.loc[run, "amount"].to_numpy(dtype=float)
    spread = float(values.max() - values.min()) / amount
    return run, spread


def _longest_consecutive_run(picked, anchor):
    """달이 끊기지 않고 이어지는 가장 긴 구간. 기준 거래가 든 구간을 우선한다."""
    ordered = picked.sort_values("ym")
    months = list(ordered["ym"])
    indexes = list(ordered.index)
    runs = []
    start = 0
    for i in range(1, len(months) + 1):
        if i == len(months) or (months[i] - months[i - 1]).n != 1:
            runs.append(indexes[start:i])
            start = i
    if not runs:
        return []
    holding = [r for r in runs if anchor in r]
    pool = holding if holding else runs
    return max(pool, key=len)


def compute(tx_df, meta, sales_avg_3m):
    """피처 18개와 다른 모듈이 쓰는 보조값을 낸다."""
    tx = tx_df.copy()
    tx["date"] = pd.to_datetime(tx["date"])
    tx["month"] = month_period(tx["date"])
    tx["signed"] = np.where(tx["direction"] == "IN", tx["amount"], -tx["amount"])

    monthly = tx.pivot_table(
        index="month", columns="direction", values="amount", aggfunc="sum"
    ).reindex(columns=["IN", "OUT"]).fillna(0.0)
    monthly = monthly.rename(columns={"IN": "inflow", "OUT": "outflow"})
    monthly["net"] = monthly["inflow"] - monthly["outflow"]
    monthly = monthly.sort_index()

    recurring_groups = detect_recurring(tx)
    recurring_index = set()
    for group in recurring_groups:
        recurring_index.update(group)
    recurring_count = len(recurring_groups)
    tx["is_recurring"] = tx.index.isin(recurring_index) & (tx["direction"] == "OUT")
    recurring_monthly = (tx[tx["is_recurring"]]
                         .groupby("month")["amount"].sum()
                         .reindex(monthly.index, fill_value=0.0))
    monthly["recurring"] = recurring_monthly

    balance = _daily_balance(tx, float(meta["opening_balance"]))
    month_end = balance.groupby(month_period(balance.index.to_series())).last()

    frame = monthly.reset_index()
    frame["month_end_balance"] = month_end.reindex(monthly.index).to_numpy()

    recent_balance_mean, prior_balance_mean = window_means(
        frame, "month_end_balance", T.RECENT_MONTHS, T.PRIOR_MONTHS)
    inflow_mean, _ = window_means(frame, "inflow", T.RECENT_MONTHS, T.PRIOR_MONTHS)
    outflow_mean, _ = window_means(frame, "outflow", T.RECENT_MONTHS, T.PRIOR_MONTHS)
    net_mean, _ = window_means(frame, "net", T.RECENT_MONTHS, T.PRIOR_MONTHS)
    recurring_mean, prior_recurring_mean = window_means(
        frame, "recurring", T.RECENT_MONTHS, T.PRIOR_MONTHS)

    recent_months = list(monthly.index[-T.RECENT_MONTHS:])
    recent_balance = balance[month_period(balance.index.to_series()).isin(recent_months)]

    net = frame["net"].to_numpy(dtype=float)
    latest_month_end = float(frame["month_end_balance"].iloc[-1]) if len(frame) else MISSING
    daily_outflow = ratio(outflow_mean, T.DAYS_PER_MONTH)
    buffer_days = cash_buffer_days(latest_month_end, daily_outflow)

    features = {
        "fin_avg_month_end_balance_3m": recent_balance_mean,
        "fin_min_month_end_balance_6m": float(frame["month_end_balance"].min()) if len(frame) else MISSING,
        "fin_month_end_balance_growth_3m": growth(recent_balance_mean, prior_balance_mean),
        "fin_cash_inflow_avg_3m": inflow_mean,
        "fin_cash_outflow_avg_3m": outflow_mean,
        "fin_net_cashflow_avg_3m": net_mean,
        "fin_net_cashflow_positive_month_ratio_6m": ratio(int((net > 0).sum()), len(net)),
        "fin_cashflow_trend_slope_6m": slope(net[-T.TREND_MONTHS:]),
        "fin_cashflow_deficit_month_count_6m": int((net < 0).sum()),
        "fin_cash_buffer_days_est": buffer_days,
        "fin_cashflow_to_sales_ratio": ratio(net_mean, sales_avg_3m),
        "fin_recurring_outflow_avg_3m": recurring_mean if recurring_count else MISSING,
        "fin_recurring_outflow_ratio": (ratio(recurring_mean, outflow_mean)
                                        if recurring_count else MISSING),
        "fin_recurring_outflow_count": recurring_count,
        "fin_recurring_outflow_growth_3m": (growth(recurring_mean, prior_recurring_mean)
                                            if recurring_count else MISSING),
        "fin_min_daily_balance_3m": float(recent_balance.min()) if len(recent_balance) else MISSING,
        "fin_low_balance_day_count_3m": _low_balance_days(balance, frame, monthly.index,
                                                          recent_months, recurring_count),
        "fin_balance_volatility_3m": (float(recent_balance.std(ddof=1))
                                      if len(recent_balance) > 1 else MISSING),
    }

    aux = {
        "monthly": frame,
        "daily_balance": balance,
        "inflow_tx": tx[tx["direction"] == "IN"][["date", "amount"]].copy(),
        "recent_months": recent_months,
        "recurring_group_count": recurring_count,
    }
    return features, aux


def _daily_balance(tx, opening_balance):
    """opening_balance에 거래를 날짜순으로 누적한 일별 잔액."""
    if tx.empty:
        return pd.Series(dtype=float)
    start = tx["date"].min().to_period("M").start_time
    end = tx["date"].max().to_period("M").end_time.normalize()
    index = pd.date_range(start, end, freq="D")
    daily = tx.groupby("date")["signed"].sum().reindex(index, fill_value=0.0)
    return opening_balance + daily.cumsum()


def _low_balance_days(balance, frame, months, recent_months, recurring_count):
    """일별 잔액이 그 달 반복 출금 합계보다 낮은 날의 수. 최근 3개월 합계."""
    if not recurring_count or balance.empty:
        return MISSING
    thresholds_by_month = dict(zip(months, frame["recurring"].to_numpy(dtype=float)))
    periods = month_period(balance.index.to_series())
    count = 0
    for period in recent_months:
        limit = thresholds_by_month.get(period)
        if limit is None:
            continue
        count += int((balance[periods == period] < limit).sum())
    return count
