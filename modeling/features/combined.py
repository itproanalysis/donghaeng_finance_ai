"""여러 소스를 조합한 피처 16개."""

import numpy as np
import pandas as pd

from .. import thresholds as T
from ..common import (MISSING, NOT_APPLICABLE, compose, is_number, is_state,
                      month_period, ratio, signal_down, signal_up)
from ..decompose import MIXED, NOT_DECLINING, UNKNOWN, sales_drop_driver

FEATURE_NAMES = (
    "fin_settlement_lag_days",
    "fin_deposit_to_card_sales_ratio",
    "fin_stated_sales_gap",
    "fin_sales_consistency_score",
    "biz_seasonality_statement_match",
    "ops_weekday_sales_share_change",
    "own_goal_stretch_ratio",
    "own_plan_budget_to_cashflow_ratio",
    "own_fund_to_cashflow_ratio",
    "imp_recovery_momentum",
    "imp_cashflow_stabilization",
    "imp_sales_recovery_potential",
    "imp_future_demand_visibility",
    "imp_cost_adjustment_headroom",
    "imp_plan_feasibility",
    "imp_goal_data_alignment",
)


def payable_cashflow(net_cashflow):
    """부담 비율의 분모로 쓸 순현금흐름.

    0 이하면 "월 현금흐름의 몇 배"라는 값이 성립하지 않는다. 그대로 나누면 음수가
    나와 부담이 작은 것으로 읽힌다.
    """
    if not is_number(net_cashflow) or net_cashflow <= 0:
        return MISSING
    return net_cashflow


def compute(features, card_sales_df, card_aux, account_aux, docs, stated_monthly_sales):
    sales_avg_3m = features.get("fin_sales_avg_3m")
    net_cashflow = features.get("fin_net_cashflow_avg_3m")

    goal_feature = features.get("own_goal_evidence_feature")
    goal_target = features.get("own_goal_target_value")
    goal_current = features.get(goal_feature) if isinstance(goal_feature, str) else MISSING
    stretch = ratio(goal_target, goal_current) if not is_state(goal_feature) else MISSING

    payable = payable_cashflow(net_cashflow)
    budget_ratio = ratio(features.get("own_plan_budget"), payable)
    fund_ratio = ratio(features.get("own_fund_amount"), payable)

    driver = sales_drop_driver(features, card_aux)
    alignment = _goal_data_alignment(features, driver, goal_feature)
    headroom = _cost_headroom(features)

    out = {
        "fin_settlement_lag_days": _settlement_lag(card_sales_df, account_aux),
        "fin_deposit_to_card_sales_ratio": _deposit_ratio(card_aux, account_aux),
        "fin_stated_sales_gap": _stated_gap(stated_monthly_sales, sales_avg_3m),
        "fin_sales_consistency_score": _consistency(stated_monthly_sales, sales_avg_3m, docs),
        "biz_seasonality_statement_match": _seasonality_match(features, card_aux),
        "ops_weekday_sales_share_change": _weekday_change(card_aux),
        "own_goal_stretch_ratio": stretch,
        "own_plan_budget_to_cashflow_ratio": budget_ratio,
        "own_fund_to_cashflow_ratio": fund_ratio,
        "imp_recovery_momentum": compose([
            signal_up(features.get("fin_sales_growth_3m"), *T.SIGNAL_SALES_GROWTH),
            signal_up(features.get("fin_cashflow_trend_slope_6m"), *T.SIGNAL_CASHFLOW_SLOPE),
            signal_up(features.get("fin_month_end_balance_growth_3m"), *T.SIGNAL_BALANCE_GROWTH),
        ]),
        "imp_cashflow_stabilization": compose([
            signal_up(features.get("fin_net_cashflow_positive_month_ratio_6m"),
                      *T.SIGNAL_POSITIVE_MONTH_RATIO),
            signal_down(features.get("fin_cashflow_deficit_month_count_6m"),
                        *T.SIGNAL_DEFICIT_MONTH_COUNT),
            signal_up(features.get("fin_month_end_balance_growth_3m"), *T.SIGNAL_BALANCE_GROWTH),
        ]),
        "imp_sales_recovery_potential": compose([
            signal_up(features.get("biz_sales_recovery_from_trough"),
                      *T.SIGNAL_RECOVERY_FROM_TROUGH),
            signal_up(features.get("ops_repeat_customer_ratio"),
                      *T.SIGNAL_REPEAT_CUSTOMER_RATIO),
            signal_up(features.get("fin_sales_growth_3m"), *T.SIGNAL_SALES_GROWTH),
        ]),
        "imp_future_demand_visibility": _future_demand(features, sales_avg_3m),
        "imp_cost_adjustment_headroom": headroom,
        "imp_plan_feasibility": compose([
            signal_down(stretch, *T.SIGNAL_GOAL_STRETCH_RATIO),
            signal_down(budget_ratio, *T.SIGNAL_PLAN_BUDGET_TO_CASHFLOW),
        ]),
        "imp_goal_data_alignment": alignment,
    }
    aux = {"sales_drop_driver": driver}
    return out, aux


def _settlement_lag(card_sales_df, account_aux):
    """하루 카드매출과 ±5% 이내인 IN 거래를 30일 안에서 찾아 날짜 차이의 중앙값."""
    inflow = account_aux.get("inflow_tx")
    if inflow is None or inflow.empty:
        return MISSING
    sales = card_sales_df.copy()
    sales["date"] = pd.to_datetime(sales["date"])
    sales = sales[sales["sales_amount"] > 0]
    if sales.empty:
        return MISSING

    in_dates = inflow["date"].to_numpy(dtype="datetime64[D]").astype("int64")
    in_amounts = inflow["amount"].to_numpy(dtype=float)
    order = np.argsort(in_dates)
    in_dates, in_amounts = in_dates[order], in_amounts[order]

    lags = []
    for sale_date, amount in zip(
        sales["date"].to_numpy(dtype="datetime64[D]").astype("int64"),
        sales["sales_amount"].to_numpy(dtype=float),
    ):
        window = (in_dates >= sale_date) & (in_dates <= sale_date + T.SETTLEMENT_MAX_LAG_DAYS)
        if not window.any():
            continue
        close = window & (np.abs(in_amounts - amount) <= amount * T.SETTLEMENT_AMOUNT_TOLERANCE)
        if not close.any():
            continue
        lags.append(int(in_dates[close].min() - sale_date))
    if not lags:
        return MISSING
    return float(np.median(lags))


def _deposit_ratio(card_aux, account_aux):
    """계좌 최근 3개월 입금 합계를 같은 기간 카드매출 합계로 나눈다."""
    months = account_aux.get("recent_months") or []
    if not months:
        return MISSING
    monthly_account = account_aux["monthly"]
    inflow = monthly_account[monthly_account["month"].isin(months)]["inflow"].sum()
    monthly_card = card_aux["monthly"]
    sales = monthly_card[monthly_card["month"].isin(months)]["sales"].sum()
    return ratio(float(inflow), float(sales))


def _stated_gap(stated, sales_avg_3m):
    if not is_number(stated) or not is_number(sales_avg_3m):
        return MISSING
    return ratio(float(stated) - float(sales_avg_3m), sales_avg_3m)


def _consistency(stated, sales_avg_3m, docs):
    """진술, 카드매출, 신고매출을 월 단위로 놓고 제일 벌어진 폭을 1에서 뺀다.

    1에 가까울수록 셋이 붙어 있다. 판정이 아니라 확인할 곳의 표시다.
    """
    vat = docs.get("vat_reported_sales_12m")
    values = [v for v in [
        float(stated) if is_number(stated) else None,
        float(sales_avg_3m) if is_number(sales_avg_3m) else None,
        float(vat) / 12.0 if is_number(vat) else None,
    ] if v is not None and v > 0]
    if len(values) < 2:
        return MISSING
    return 1.0 - (max(values) - min(values)) / max(values)


def _seasonality_match(features, card_aux):
    stated_months = features.get("own_peak_months")
    actual = card_aux.get("peak_calendar_months")
    if is_state(stated_months) or not isinstance(stated_months, (list, tuple)):
        return MISSING
    if is_state(actual) or not actual:
        return MISSING
    return bool(set(int(m) for m in stated_months) & set(actual))


def _weekday_change(card_aux):
    recent = card_aux.get("weekday_share_recent")
    prior = card_aux.get("weekday_share_prior")
    if not is_number(recent) or not is_number(prior):
        return MISSING
    return float(recent) - float(prior)


def _future_demand(features, sales_avg_3m):
    """확정 예약 금액과 커버리지를 평균 매출로 견준 방향 신호."""
    value = features.get("own_confirmed_order_value")
    weeks = features.get("own_booking_coverage_weeks")
    if value == NOT_APPLICABLE and weeks == NOT_APPLICABLE:
        return NOT_APPLICABLE
    return compose([
        signal_up(ratio(value, sales_avg_3m), *T.SIGNAL_BOOKING_VALUE_TO_SALES),
        signal_up(weeks, *T.SIGNAL_BOOKING_COVERAGE_WEEKS),
    ])


def _cost_headroom(features):
    """나가는 돈에서 반복 출금을 뺀 몫.

    docs/SCORECARD.md가 이 값을 유출 대비 비율 구간으로 쓰기 때문에 방향 신호 합이
    아니라 비율로 낸다.
    """
    outflow = features.get("fin_cash_outflow_avg_3m")
    recurring = features.get("fin_recurring_outflow_avg_3m")
    if not is_number(outflow) or not is_number(recurring):
        return MISSING
    return ratio(float(outflow) - float(recurring), float(outflow))


def _goal_data_alignment(features, driver, goal_feature):
    """데이터가 가리키는 문제와 사장님이 꼽은 문제, 고른 목표가 맞는지.

    재료 둘. 고른 목표가 하락 원인에 대응하는지, 제일 큰 문제가 그 원인에 대응하는지.
    원인이 영업일일 때 맞는 own_primary_problem 보기가 없어 그때는 두 번째 재료를 뺀다.
    """
    if driver in (UNKNOWN, MIXED, NOT_DECLINING):
        return MISSING

    signals = []
    expected_goal = T.DRIVER_GOAL_FEATURE.get(driver)
    if expected_goal and not is_state(goal_feature) and isinstance(goal_feature, str):
        signals.append(1 if goal_feature == expected_goal else -1)

    expected_problem = T.DRIVER_PRIMARY_PROBLEM.get(driver)
    problem = features.get("own_primary_problem")
    if expected_problem and not is_state(problem):
        signals.append(1 if problem == expected_problem else -1)

    return compose(signals)
