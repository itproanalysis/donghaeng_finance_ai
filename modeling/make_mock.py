"""mock 케이스 생성. 시드 고정이라 다시 돌려도 같은 케이스가 나온다.

원인이 다른 세 가게를 만든다. 세 케이스 모두 최근 3개월 평균 매출이 이전 3개월 대비
-20%이고, card_sales.csv만 다르다. account_tx, card_spend, docs, cb는 같은 파일을 쓴다.
그래야 점수와 조건부 질문 차이가 매출 원인에서만 나온다.

case_operating_drop_after는 6개월 뒤 재평가용이라 interview.json이 없다.
"""

import calendar
import json
import os
from datetime import date, timedelta

import numpy as np
import pandas as pd

SEED = 20260829

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOCK_DIR = os.path.join(ROOT, "data", "mock")

# 카드매출 12개월 창의 마지막 달
CARD_WINDOW_END = pd.Period("2026-07", freq="M")

# 세 케이스가 함께 쓰는 월별 카드매출. 앞 9개월이 평상시, 뒤 3개월이 -20%
# 최근 3개월 합 72,000,000 / 이전 3개월 합 90,000,000 이라 증가율이 정확히 -0.20
MONTHLY_SALES = [
    28_800_000, 31_200_000, 30_400_000, 29_200_000, 30_800_000, 29_600_000,
    30_000_000, 30_500_000, 29_500_000, 23_500_000, 24_000_000, 24_500_000,
]

# 재평가 케이스에서 영업일이 회복된 뒤 6개월
RECOVERY_SALES = [26_000_000, 27_500_000, 28_500_000, 29_500_000, 30_000_000, 30_500_000]

TICKET_BASE = 25_000

# 요일별 매출 가중치. 월요일 0, 일요일 6
DOW_WEIGHT = np.array([0.85, 0.88, 0.90, 0.95, 1.20, 1.35, 1.10])

# 영업일 감소 케이스에서 문을 닫는 날. 4일 간격이라 7개 요일에 하나씩 걸린다
CLOSED_DAYS = (4, 8, 12, 16, 20, 24, 28)

DELIVERY_SHARE = 0.18

SETTLEMENT_RATE = 0.97
SETTLEMENT_LAG_DAYS = 2
CASH_DEPOSIT_RATE = 0.1111
CASH_DEPOSIT_DAY = 27

# 월마다 같은 날 같은 금액으로 나가는 돈
RECURRING_OUT = (
    (5, 1_200_000, "대출상환"),
    (10, 6_500_000, "인건비"),
    (10, 450_000, "리스료"),
    (15, 180_000, "보험료"),
    (25, 3_000_000, "임대료"),
)

PURCHASE_OUT_BASE = 9_900_000
UTILITY_OUT_MIN = 900_000
UTILITY_OUT_MAX = 1_800_000
LIVING_OUT_MIN = 700_000
LIVING_OUT_MAX = 2_600_000

OPENING_BALANCE = 14_000_000

DOCS = {
    "industry": "RESTAURANT",
    "open_date": "2018-03-15",
    "store_count": 1,
    "monthly_rent": 3_000_000,
    "vat_reported_sales_12m": 380_000_000,
}

CB = {
    "score": 712,
    "grade": "5등급",
    "percentile": 0.48,
    "delinquency_prob": 0.019,
    "monthly_debt_payment": 1_200_000,
    "opinion": (
        "최근 3개월 카드매출이 직전 3개월 대비 감소했고 현금흐름이 얇아졌다. "
        "기존 대출 상환은 정상 이행 중이며 연체 이력은 없다."
    ),
}

# 매출이 평탄한 케이스의 CB 의견. 심사 의견은 그 가게의 데이터를 보고 쓰인 것이라
# 케이스마다 맞춰야 화면에 나란히 놓았을 때 어긋나지 않는다
FLAT_CB = dict(
    CB,
    opinion=(
        "최근 3개월 카드매출이 직전 3개월과 비슷한 수준을 유지하고 있다. "
        "상환은 정상 이행 중이며 연체 이력은 없다."
    ),
)

# 계절을 타는 케이스의 CB 의견
SEASONAL_CB = dict(
    CB,
    opinion=(
        "월별 카드매출 진폭이 크고 최근 3개월은 매출이 몰리는 구간이다. "
        "연중 편차를 감안해 볼 필요가 있으며 연체 이력은 없다."
    ),
)

# 6개월 뒤 재평가 케이스의 CB 의견. 그 사이 CB도 다시 조회된다
RECOVERED_CB = dict(
    CB,
    opinion=(
        "카드매출이 최근 6개월 동안 회복되어 직전 구간을 웃돈다. "
        "상환은 정상 이행 중이며 연체 이력은 없다."
    ),
)

# 카드 사용내역에서 마케팅 결제가 찍힌 달
MARKETING_MONTHS = ("2025-11", "2026-03", "2026-05", "2026-09")

# 매출이 평탄한 케이스의 월별 카드매출. 최근 3개월과 이전 3개월 합이 거의 같다
FLAT_SALES = [
    29_800_000, 30_200_000, 29_600_000, 30_400_000, 29_900_000, 30_100_000,
    30_000_000, 29_700_000, 30_300_000, 29_900_000, 30_200_000, 29_800_000,
]

# 비용 압박 케이스. 매출은 평탄하지만 규모가 작아 순현금흐름이 얇다
COST_PRESSURE_SALES = [
    24_900_000, 25_100_000, 24_800_000, 25_200_000, 25_000_000, 24_900_000,
    25_100_000, 24_900_000, 25_000_000, 25_100_000, 24_800_000, 25_100_000,
]
COST_PRESSURE_OPENING = 11_000_000
# 최근 3개월에만 새로 생기는 반복 출금. 새로 받은 대출의 월 상환액.
# 변동 지출이 닿지 않는 금액대라야 반복 출금 묶음이 변동 지출과 섞이지 않는다
NEW_LOAN_OUT = ((18, 4_500_000, "신규 대출 상환"),)
# 새 대출이 잡힌 뒤의 CB. 월 상환액에 기존 1,200,000과 새 4,500,000이 함께 들어간다
COST_PRESSURE_CB = dict(
    CB,
    monthly_debt_payment=5_700_000,
    opinion=(
        "카드매출은 유지되고 있으나 최근 신규 대출이 반영되며 월 상환 부담이 늘었다. "
        "연체 이력은 없다."
    ),
)

# 수요 이동 케이스. 최근 3개월의 배달 비중, 주중 가중치, 매입 지출을 올린다
DEMAND_SHIFT_DELIVERY = 0.35
DEMAND_SHIFT_WEEKDAY_BOOST = 1.85
DEMAND_SHIFT_PURCHASE_SCALE = 1.25

# 계약이 미리 잡혀 있는 업종 케이스
INTERIOR_DOCS = dict(DOCS, industry="INTERIOR")
INTERIOR_BOOKING_WEEKS = 9
INTERIOR_BOOKING_VALUE = 45_000_000

# 변동이 큰 케이스. 여름에 매출이 몰려 성수기와 비수기가 다섯 배 넘게 벌어진다.
# 카드 12개월 창이 2025-08에서 2026-07까지이므로 양 끝이 성수기다
VOLATILE_SALES = [
    45_000_000, 22_000_000, 14_000_000, 10_000_000, 9_000_000, 8_000_000,
    8_000_000, 11_000_000, 16_000_000, 24_000_000, 40_000_000, 46_000_000,
]
VOLATILE_OPENING = 40_000_000

# 매달 바닥을 새로 찍는 케이스. 마지막 달이 그 전 어느 달보다도 낮다
NEW_LOW_SALES = [
    34_000_000, 32_000_000, 30_000_000, 28_000_000, 26_000_000, 24_000_000,
    22_000_000, 20_000_000, 18_000_000, 16_000_000, 14_000_000, 12_000_000,
]
NEW_LOW_OPENING = 27_000_000
# 매출이 줄어든 뒤에도 상환액은 그대로다. 매출 대비 부담이 30%를 넘는다
NEW_LOW_CB = dict(
    CB,
    monthly_debt_payment=4_500_000,
    opinion=(
        "카드매출이 12개월 내내 줄어 최근 3개월이 최저 구간이다. "
        "상환은 이행 중이나 매출 대비 부담이 커졌다."
    ),
)


def rng_for(period):
    """달마다 고정된 난수 생성기. 창이 겹치는 케이스끼리 같은 달은 같은 값이 나온다."""
    return np.random.default_rng(SEED + period.year * 100 + period.month)


def month_days(period):
    return calendar.monthrange(period.year, period.month)[1]


def periods_ending(last_period, count):
    return [last_period - i for i in range(count - 1, -1, -1)]


def allocate_counts(weights, total):
    """가중치대로 정수를 나눠 담되 합이 정확히 total이 되게 한다."""
    w = np.asarray(weights, dtype=float)
    share = w / w.sum() * total
    base = np.floor(share).astype(int)
    remainder = int(total - base.sum())
    if remainder > 0:
        order = np.argsort(-(share - base), kind="stable")
        base[order[:remainder]] += 1
    return base


def daily_weights(period, open_days, dow_weight=DOW_WEIGHT):
    """요일 가중치에 달마다 고정된 흔들림을 얹는다."""
    rng = rng_for(period)
    noise = rng.uniform(-0.10, 0.10, size=month_days(period))
    weights = []
    for day in open_days:
        dow = date(period.year, period.month, day).weekday()
        weights.append(dow_weight[dow] * (1.0 + noise[day - 1]))
    return np.asarray(weights)


def month_rows(period, monthly_sales, ticket, open_days,
               delivery_share=DELIVERY_SHARE, dow_weight=DOW_WEIGHT):
    """한 달치 일별 카드매출. 건수를 먼저 정수로 나누고 매출은 건수 곱하기 1인당 결제액."""
    total_count = int(round(monthly_sales / ticket))
    counts = allocate_counts(daily_weights(period, open_days, dow_weight), total_count)
    rng = rng_for(period)
    rng.uniform(size=month_days(period))
    delivery_noise = rng.uniform(-0.04, 0.04, size=month_days(period))

    rows = []
    closed = [d for d in range(1, month_days(period) + 1) if d not in set(open_days)]
    for day, count in zip(open_days, counts):
        sales = int(count) * int(ticket)
        share = delivery_share + delivery_noise[day - 1]
        rows.append({
            "date": date(period.year, period.month, day).isoformat(),
            "sales_amount": sales,
            "txn_count": int(count),
            "delivery_amount": int(round(sales * share / 100.0) * 100),
        })
    for day in closed:
        rows.append({
            "date": date(period.year, period.month, day).isoformat(),
            "sales_amount": 0,
            "txn_count": 0,
            "delivery_amount": 0,
        })
    rows.sort(key=lambda r: r["date"])
    return rows


def build_card_sales(months, monthly_sales, variant,
                     delivery_of=None, dow_weight_of=None):
    """케이스 종류에 따라 최근 3개월의 구성만 바꾼다.

    baseline  평상시 달. 세 케이스가 같은 파일을 쓴다
    customer  결제 건수 -20%, 1인당 결제액과 영업일 유지
    ticket    1인당 결제액 -20%, 건수와 영업일 유지
    operating 영업일 -20%, 영업일당 매출 유지

    delivery_of와 dow_weight_of는 달 번호를 받아 그달의 배달 비중과 요일 가중치를 낸다.
    안 주면 전 기간 같은 값을 쓴다.
    """
    rows = []
    for idx, period in enumerate(months):
        sales = monthly_sales[idx]
        kind = variant(idx, period)
        all_days = list(range(1, month_days(period) + 1))
        if kind == "operating":
            open_days = [d for d in all_days if d not in CLOSED_DAYS]
            ticket = TICKET_BASE
        elif kind == "ticket":
            open_days = all_days
            pre_drop_count = int(round(sales / 0.8 / TICKET_BASE))
            ticket = int(round(sales / pre_drop_count))
        else:
            open_days = all_days
            ticket = TICKET_BASE
        rows.extend(month_rows(
            period, sales, ticket, open_days,
            DELIVERY_SHARE if delivery_of is None else delivery_of(idx),
            DOW_WEIGHT if dow_weight_of is None else dow_weight_of(idx),
        ))
    return pd.DataFrame(rows)


def build_account(months, card_sales_df, monthly_sales_by_period, opening_balance,
                  extra_recurring_of=None):
    """계좌 6개월. 카드 정산 입금과 현금 입금, 고정 출금과 변동 출금.

    extra_recurring_of는 달을 받아 그달에만 더 나가는 반복 출금을 낸다.
    """
    start = date(months[0].year, months[0].month, 1)
    end_period = months[-1]
    end = date(end_period.year, end_period.month, month_days(end_period))

    rows = []

    sales = card_sales_df.copy()
    sales["date"] = pd.to_datetime(sales["date"]).dt.date
    for _, row in sales.iterrows():
        if row["sales_amount"] <= 0:
            continue
        paid_on = row["date"] + timedelta(days=SETTLEMENT_LAG_DAYS)
        if paid_on < start or paid_on > end:
            continue
        rows.append({
            "date": paid_on.isoformat(),
            "direction": "IN",
            "amount": int(round(row["sales_amount"] * SETTLEMENT_RATE / 100.0) * 100),
        })

    for period in months:
        month_sales = monthly_sales_by_period[period]
        scale = month_sales / 30_000_000.0
        rng = np.random.default_rng(SEED + 3 + period.year * 100 + period.month)

        rows.append({
            "date": date(period.year, period.month, CASH_DEPOSIT_DAY).isoformat(),
            "direction": "IN",
            "amount": int(round(month_sales * CASH_DEPOSIT_RATE / 10_000.0) * 10_000),
        })

        extra = () if extra_recurring_of is None else extra_recurring_of(period)
        for day, amount, _label in tuple(RECURRING_OUT) + tuple(extra):
            rows.append({
                "date": date(period.year, period.month, day).isoformat(),
                "direction": "OUT",
                "amount": int(amount),
            })

        purchase_days = np.sort(rng.choice(np.arange(1, 29), size=4, replace=False))
        purchase_weights = rng.uniform(0.35, 1.65, size=4)
        purchase_total = PURCHASE_OUT_BASE * scale
        for day, weight in zip(purchase_days, purchase_weights / purchase_weights.sum()):
            rows.append({
                "date": date(period.year, period.month, int(day)).isoformat(),
                "direction": "OUT",
                "amount": int(round(purchase_total * weight / 100.0) * 100),
            })

        rows.append({
            "date": date(period.year, period.month, int(rng.integers(6, 29))).isoformat(),
            "direction": "OUT",
            "amount": int(round(rng.uniform(UTILITY_OUT_MIN, UTILITY_OUT_MAX) / 100.0) * 100),
        })

        living_days = rng.choice(np.arange(1, 29), size=2, replace=False)
        for day in living_days:
            rows.append({
                "date": date(period.year, period.month, int(day)).isoformat(),
                "direction": "OUT",
                "amount": int(round(rng.uniform(LIVING_OUT_MIN, LIVING_OUT_MAX) / 100.0) * 100),
            })

        misc_days = rng.choice(np.arange(1, 29), size=2, replace=False)
        for day in misc_days:
            rows.append({
                "date": date(period.year, period.month, int(day)).isoformat(),
                "direction": "OUT",
                "amount": int(round(rng.uniform(60_000, 550_000) / 100.0) * 100),
            })

    df = pd.DataFrame(rows).sort_values(["date", "direction"]).reset_index(drop=True)
    signed = np.where(df["direction"] == "IN", df["amount"], -df["amount"])
    closing_balance = int(opening_balance + signed.sum())
    return df, closing_balance


def build_card_spend(months, monthly_sales_by_period, purchase_scale_of=None):
    """카드 사용내역 12개월. purchase, marketing, business, personal.

    purchase_scale_of는 달을 받아 그달 매입 지출에 곱할 배수를 낸다.
    """
    rows = []
    for period in months:
        scale = monthly_sales_by_period[period] / 30_000_000.0
        rng = np.random.default_rng(SEED + 7 + period.year * 100 + period.month)

        purchase_total = 2_400_000 * scale
        if purchase_scale_of is not None:
            purchase_total *= purchase_scale_of(period)
        weights = rng.uniform(0.7, 1.3, size=6)
        for day, weight in zip(rng.choice(np.arange(1, 29), size=6, replace=False),
                               weights / weights.sum()):
            rows.append({
                "date": date(period.year, period.month, int(day)).isoformat(),
                "amount": int(round(purchase_total * weight / 100.0) * 100),
                "category": "purchase",
            })

        for day in rng.choice(np.arange(1, 29), size=4, replace=False):
            rows.append({
                "date": date(period.year, period.month, int(day)).isoformat(),
                "amount": int(round(150_000 * (1.0 + rng.uniform(-0.3, 0.3)) / 100.0) * 100),
                "category": "business",
            })

        for day in rng.choice(np.arange(1, 29), size=5, replace=False):
            rows.append({
                "date": date(period.year, period.month, int(day)).isoformat(),
                "amount": int(round(120_000 * (1.0 + rng.uniform(-0.4, 0.4)) / 100.0) * 100),
                "category": "personal",
            })

        if str(period) in MARKETING_MONTHS:
            rows.append({
                "date": date(period.year, period.month, 12).isoformat(),
                "amount": 350_000,
                "category": "marketing",
            })

    return pd.DataFrame(rows).sort_values("date").reset_index(drop=True)


# 세 케이스가 함께 쓰는 인터뷰 답. 목표, 계획, 가계 항목은 케이스마다 같게 채운다
INTERVIEW_COMMON = {
    # 케이스마다 덮어쓴다. 카드매출에 안 잡히는 현금 몫이 있어 실제보다 조금 높게 말한다
    "stated_monthly_sales": 26_000_000,
    "own_confirmed_order_value": "NOT_APPLICABLE",
    "own_booking_coverage_weeks": "NOT_APPLICABLE",
    "own_confirmed_order_deposit_flag": "NOT_APPLICABLE",
    "own_seasonality_direction": "비수기",
    "own_peak_months": [12, 1],
    "own_essential_expense": "REFUSED",
    "own_buffer_months": 3,
    "ops_repeat_customer_ratio": 0.45,
    "own_goal_horizon_days": 180,
    "own_goal_self_selected_flag": True,
    "own_plan_action_category": "홍보",
    "own_plan_horizon_days": 180,
    "own_plan_budget": 800_000,
    "own_plan_blockers": ["자금", "일손"],
    "own_plan_top_blocker": "자금",
    "own_prior_action_type": "할인",
    "own_prior_action_result": "모르겠다",
    "own_prior_action_ongoing_flag": False,
    "own_fund_purpose": "운전자금",
    "own_fund_amount": "UNDECIDED",
    "own_operating_day_drop_reason": "NOT_APPLICABLE",
    "own_operating_day_drop_resolved_flag": "NOT_APPLICABLE",
    "own_fixed_cost_increase_reason": "NOT_APPLICABLE",
    "own_low_balance_coping_method": "NOT_APPLICABLE",
    "own_purchase_increase_reason": "NOT_APPLICABLE",
    "ops_platform_fee_ratio": "NOT_APPLICABLE",
    "biz_hall_customer_decline_flag": "NOT_APPLICABLE",
}


# 케이스마다 다른 인터뷰 답. 추가 질문 답은 그 케이스에서 실제로 나온 질문에만 채운다
CASE_INTERVIEW = {
    "case_customer_drop": {
        "own_primary_problem": "손님 감소",
        "own_goal_evidence_feature": "ops_transaction_count_avg_3m",
    },
    "case_ticket_drop": {
        "own_primary_problem": "단가 압박",
        "own_goal_evidence_feature": "ops_avg_ticket_3m",
    },
    "case_operating_drop": {
        "own_primary_problem": "일손 부족",
        "own_goal_evidence_feature": "biz_operating_day_count_avg_3m",
        "own_operating_day_drop_reason": "건강",
        "own_operating_day_drop_resolved_flag": True,
        "evidence_text": {
            "own_operating_day_drop_reason": "허리를 다쳐서 봄에 몇 달 문을 자주 못 열었다.",
            "own_operating_day_drop_resolved_flag": "지금은 치료가 끝나서 다시 매일 연다.",
        },
    },
    "case_no_answer": {
        "own_primary_problem": "일손 부족",
        "own_goal_evidence_feature": "biz_operating_day_count_avg_3m",
        # 영업일 질문은 나왔지만 답이 없다
        "own_operating_day_drop_reason": "MISSING",
        "own_operating_day_drop_resolved_flag": "MISSING",
        # 다시 물어도 목표값, 기간, 예산을 정하지 못했다
        "own_goal_horizon_days": "UNDECIDED",
        "own_plan_budget": "UNDECIDED",
    },
    "case_cost_pressure": {
        "stated_monthly_sales": 27_000_000,
        "own_primary_problem": "고정비 부담",
        "own_goal_evidence_feature": "fin_recurring_outflow_avg_3m",
        "own_fixed_cost_increase_reason": "신규 대출",
        "own_low_balance_coping_method": "대금 미루기",
        "evidence_text": {
            "own_fixed_cost_increase_reason": "봄에 대출을 새로 받아 매달 상환이 시작됐다.",
            "own_low_balance_coping_method": "월말에 돈이 모자라면 거래처 대금을 다음 달로 미룬다.",
        },
    },
    "case_demand_shift": {
        "stated_monthly_sales": 32_000_000,
        "own_primary_problem": "손님 감소",
        "own_goal_evidence_feature": "ops_avg_ticket_3m",
        "own_purchase_increase_reason": "원가 상승",
        "ops_platform_fee_ratio": 0.13,
        "biz_hall_customer_decline_flag": True,
        "evidence_text": {
            "own_purchase_increase_reason": "식자재 값이 올라 같은 양을 사도 더 나간다.",
            "biz_hall_customer_decline_flag": "주말에 홀에 앉는 손님이 눈에 띄게 줄었다.",
        },
    },
    "case_interior": {
        "stated_monthly_sales": 32_000_000,
        "own_primary_problem": "자금 경색",
        "own_goal_evidence_feature": "ops_transaction_count_avg_3m",
        "own_confirmed_order_value": INTERIOR_BOOKING_VALUE,
        "own_booking_coverage_weeks": INTERIOR_BOOKING_WEEKS,
        "own_confirmed_order_deposit_flag": True,
    },
    "case_volatile": {
        "stated_monthly_sales": 38_000_000,
        "own_primary_problem": "자금 경색",
        "own_goal_evidence_feature": "fin_min_daily_balance_3m",
        "own_seasonality_direction": "성수기",
        "own_peak_months": [6, 7, 8],
        "own_purchase_increase_reason": "재고 확보",
        "own_low_balance_coping_method": "그냥 버팀",
        "evidence_text": {
            "own_purchase_increase_reason": "여름 성수기에 맞춰 재료를 미리 들여놨다.",
            "own_low_balance_coping_method": "겨울에는 돈이 마르지만 여름 매출로 메운다.",
        },
    },
    "case_new_low": {
        "stated_monthly_sales": 15_000_000,
        "own_primary_problem": "손님 감소",
        "own_goal_evidence_feature": "ops_transaction_count_avg_3m",
        # 계좌에 추가 자금이 들어온 흔적이 없으므로 답도 그에 맞춘다
        "own_low_balance_coping_method": "그냥 버팀",
        "evidence_text": {
            "own_low_balance_coping_method": "따로 빌리지는 않고 있는 돈으로 버티고 있다.",
        },
    },
}


def interview_for(case_id, goal_target):
    """공통 답에 케이스별 답을 얹는다."""
    answers = dict(INTERVIEW_COMMON)
    answers.update(CASE_INTERVIEW[case_id])
    answers["own_goal_target_value"] = goal_target
    return answers


def business_age_months(open_date_text, reference):
    opened = date.fromisoformat(open_date_text)
    months = (reference.year - opened.year) * 12 + (reference.month - opened.month)
    if reference.day < opened.day:
        months -= 1
    return months


def expected_features(case_id, months, recent_counts, recent_open_days, prior_open_days):
    """케이스 설계에서 값이 못박히는 피처만 적는다. build.py를 돌려서 만든 값이 아니다."""
    recent_sales = MONTHLY_SALES[-3:]
    prior_sales = MONTHLY_SALES[-6:-3]
    recent_sales_sum = float(sum(recent_sales))
    prior_sales_sum = float(sum(prior_sales))
    prior_counts = [int(round(s / TICKET_BASE)) for s in prior_sales]

    recent_count_sum = float(sum(recent_counts))
    prior_count_sum = float(sum(prior_counts))
    recent_ticket = recent_sales_sum / recent_count_sum
    prior_ticket = prior_sales_sum / prior_count_sum
    recent_days_avg = sum(recent_open_days) / 3.0
    prior_days_avg = sum(prior_open_days) / 3.0

    last_period = months[-1]
    reference = date(last_period.year, last_period.month, month_days(last_period))

    return {
        "fin_sales_avg_3m": recent_sales_sum / 3.0,
        "fin_sales_avg_12m": float(sum(MONTHLY_SALES)) / 12.0,
        "fin_sales_growth_3m": recent_sales_sum / prior_sales_sum - 1.0,
        "biz_observed_month_count": 12,
        "biz_zero_sales_month_count_12m": 0,
        "biz_consecutive_active_months": 12,
        "biz_recent_activity_flag": True,
        "ops_transaction_count_avg_3m": recent_count_sum / 3.0,
        "ops_avg_ticket_3m": recent_ticket,
        "ops_count_growth_3m": recent_count_sum / prior_count_sum - 1.0,
        "ops_ticket_growth_3m": recent_ticket / prior_ticket - 1.0,
        "biz_operating_day_count_avg_3m": recent_days_avg,
        "biz_operating_day_change_3m": recent_days_avg / prior_days_avg - 1.0,
        "fin_sales_per_operating_day_3m": recent_sales_sum / float(sum(recent_open_days)),
        "biz_industry_code": DOCS["industry"],
        "biz_store_count": DOCS["store_count"],
        "biz_business_age_months": business_age_months(DOCS["open_date"], reference),
        "fin_rent_to_sales_ratio": DOCS["monthly_rent"] / (recent_sales_sum / 3.0),
        "fin_cash_sales_ratio": (
            (DOCS["vat_reported_sales_12m"] - sum(MONTHLY_SALES))
            / DOCS["vat_reported_sales_12m"]
        ),
        "crd_debt_payment_to_sales_ratio": CB["monthly_debt_payment"] / (recent_sales_sum / 3.0),
        "fin_settlement_lag_days": float(SETTLEMENT_LAG_DAYS),
        "own_essential_expense": "REFUSED",
        "own_fund_amount": "UNDECIDED",
        "own_fund_to_cashflow_ratio": "MISSING",
        "own_confirmed_order_value": "NOT_APPLICABLE",
        "own_booking_coverage_weeks": "NOT_APPLICABLE",
        "own_confirmed_order_deposit_flag": "NOT_APPLICABLE",
        "own_primary_problem": interview_for(case_id, 0)["own_primary_problem"],
        "own_operating_day_drop_reason": interview_for(case_id, 0)["own_operating_day_drop_reason"],
    }


def write_case(case_id, card_sales, account_tx, opening_balance, card_spend,
               interview, expected, docs=None, cb=None):
    """케이스 하나를 파일로 떨군다."""
    case_dir = os.path.join(MOCK_DIR, case_id)
    os.makedirs(case_dir, exist_ok=True)

    card_sales.to_csv(os.path.join(case_dir, "card_sales.csv"), index=False)
    account_tx.to_csv(os.path.join(case_dir, "account_tx.csv"), index=False)
    card_spend.to_csv(os.path.join(case_dir, "card_spend.csv"), index=False)

    def dump(name, payload):
        with open(os.path.join(case_dir, name), "w", encoding="utf-8") as handle:
            json.dump(payload, handle, ensure_ascii=False, indent=2)
            handle.write("\n")

    dump("account_meta.json", {"opening_balance": int(opening_balance)})
    dump("docs.json", DOCS if docs is None else docs)
    dump("cb.json", CB if cb is None else cb)
    if interview is not None:
        dump("interview.json", interview)
    if expected is not None:
        dump("expected_features.json", expected)
    return case_dir


def variant_for(kind, drop_from_index):
    def pick(idx, _period):
        return kind if idx >= drop_from_index else "baseline"
    return pick


def open_days_of(period, kind):
    days = month_days(period)
    if kind == "operating":
        return [d for d in range(1, days + 1) if d not in CLOSED_DAYS]
    return list(range(1, days + 1))


def flat_variant(_idx, _period):
    return "baseline"


def recent_three(months):
    """최근 3개월 달 집합."""
    return set(months[-3:])


def build_cost_pressure(months):
    """매출은 평탄한데 최근 3개월에 새 대출 상환이 붙어 반복 출금이 늘었다.

    시작 잔액을 낮춰 잔액이 그달 반복 출금에 못 미치는 날이 최근 3개월에 생긴다.
    """
    sales_by_period = dict(zip(months, COST_PRESSURE_SALES))
    recent = recent_three(months)
    card_sales = build_card_sales(months, COST_PRESSURE_SALES, flat_variant)
    account_tx, _ = build_account(
        months[-6:], card_sales, sales_by_period, COST_PRESSURE_OPENING,
        extra_recurring_of=lambda period: NEW_LOAN_OUT if period in recent else (),
    )
    card_spend = build_card_spend(months, sales_by_period)
    return write_case("case_cost_pressure", card_sales, account_tx, COST_PRESSURE_OPENING,
                      card_spend, interview_for("case_cost_pressure", 11_330_000), None,
                      cb=COST_PRESSURE_CB)


def build_demand_shift(months, _monthly_sales_by_period):
    """매출은 평탄한데 최근 3개월에 배달 비중, 주중 비중, 매입 지출이 함께 올랐다."""
    sales_by_period = dict(zip(months, FLAT_SALES))
    recent = recent_three(months)
    boost = np.array([DEMAND_SHIFT_WEEKDAY_BOOST] * 5 + [1.0, 1.0])
    card_sales = build_card_sales(
        months, FLAT_SALES, flat_variant,
        delivery_of=lambda idx: DEMAND_SHIFT_DELIVERY if idx >= 9 else DELIVERY_SHARE,
        dow_weight_of=lambda idx: DOW_WEIGHT * boost if idx >= 9 else DOW_WEIGHT,
    )
    account_tx, _ = build_account(months[-6:], card_sales, sales_by_period, OPENING_BALANCE)
    card_spend = build_card_spend(
        months, sales_by_period,
        purchase_scale_of=lambda period: DEMAND_SHIFT_PURCHASE_SCALE if period in recent else 1.0,
    )
    return write_case("case_demand_shift", card_sales, account_tx, OPENING_BALANCE,
                      card_spend, interview_for("case_demand_shift", 38_000), None,
                      cb=FLAT_CB)


def build_interior(months, _monthly_sales_by_period):
    """계약이 미리 잡혀 있는 업종. 매출은 평탄하고 9주치 계약과 계약금이 잡혀 있다."""
    sales_by_period = dict(zip(months, FLAT_SALES))
    card_sales = build_card_sales(months, FLAT_SALES, flat_variant)
    account_tx, _ = build_account(months[-6:], card_sales, sales_by_period, OPENING_BALANCE)
    card_spend = build_card_spend(months, sales_by_period)
    return write_case("case_interior", card_sales, account_tx, OPENING_BALANCE,
                      card_spend, interview_for("case_interior", 1_300), None,
                      docs=INTERIOR_DOCS, cb=FLAT_CB)


def build_new_low(months):
    """매출이 매달 줄어 마지막 달이 12개월 중 제일 낮다. 상환 부담이 매출 대비 30%를 넘는다."""
    sales_by_period = dict(zip(months, NEW_LOW_SALES))
    card_sales = build_card_sales(months, NEW_LOW_SALES, flat_variant)
    account_tx, _ = build_account(months[-6:], card_sales, sales_by_period, NEW_LOW_OPENING)
    card_spend = build_card_spend(months, sales_by_period)
    return write_case("case_new_low", card_sales, account_tx, NEW_LOW_OPENING,
                      card_spend, interview_for("case_new_low", 700), None,
                      cb=NEW_LOW_CB)


def build_volatile(months):
    """여름에 매출이 몰리는 가게. 최근 6개월에 비수기와 성수기가 함께 들어와
    매출 변동계수가 0.5를 넘는다. 성수기 진술과 실제 피크 달도 맞춰 볼 수 있다."""
    sales_by_period = dict(zip(months, VOLATILE_SALES))
    card_sales = build_card_sales(months, VOLATILE_SALES, flat_variant)
    account_tx, _ = build_account(months[-6:], card_sales, sales_by_period, VOLATILE_OPENING)
    card_spend = build_card_spend(months, sales_by_period)
    return write_case("case_volatile", card_sales, account_tx, VOLATILE_OPENING,
                      card_spend, interview_for("case_volatile", 12_000_000), None,
                      cb=SEASONAL_CB)


def main():
    months = periods_ending(CARD_WINDOW_END, 12)
    monthly_sales_by_period = dict(zip(months, MONTHLY_SALES))
    account_months = months[-6:]

    cases = {
        "case_customer_drop": ("customer", 1_200),
        "case_ticket_drop": ("ticket", 25_000),
        "case_operating_drop": ("operating", 29),
    }

    card_sales_by_case = {}
    for case_id, (kind, _target) in cases.items():
        card_sales_by_case[case_id] = build_card_sales(
            months, MONTHLY_SALES, variant_for(kind, 9)
        )

    account_tx, closing_balance = build_account(
        account_months,
        card_sales_by_case["case_customer_drop"],
        monthly_sales_by_period,
        OPENING_BALANCE,
    )
    card_spend = build_card_spend(months, monthly_sales_by_period)

    prior_open_days = [month_days(p) for p in months[-6:-3]]
    written = []
    for case_id, (kind, target) in cases.items():
        recent_open_days = [len(open_days_of(p, kind)) for p in months[-3:]]
        if kind == "ticket":
            recent_counts = [int(round(s / 0.8 / TICKET_BASE)) for s in MONTHLY_SALES[-3:]]
        else:
            recent_counts = [int(round(s / TICKET_BASE)) for s in MONTHLY_SALES[-3:]]
        written.append(write_case(
            case_id,
            card_sales_by_case[case_id],
            account_tx,
            OPENING_BALANCE,
            card_spend,
            interview_for(case_id, target),
            expected_features(case_id, months, recent_counts, recent_open_days, prior_open_days),
        ))

    written.append(write_case(
        "case_no_answer",
        card_sales_by_case["case_operating_drop"],
        account_tx,
        OPENING_BALANCE,
        card_spend,
        interview_for("case_no_answer", "UNDECIDED"),
        None,
    ))

    written.append(build_cost_pressure(months))
    written.append(build_demand_shift(months, monthly_sales_by_period))
    written.append(build_interior(months, monthly_sales_by_period))
    written.append(build_volatile(months))
    written.append(build_new_low(months))

    after_months = periods_ending(pd.Period("2027-01", freq="M"), 12)
    after_sales = MONTHLY_SALES[6:] + RECOVERY_SALES
    after_sales_by_period = dict(zip(after_months, after_sales))

    def after_variant(idx, _period):
        return "operating" if 3 <= idx <= 5 else "baseline"

    after_card_sales = build_card_sales(after_months, after_sales, after_variant)
    after_account_tx, _ = build_account(
        after_months[-6:], after_card_sales, after_sales_by_period, closing_balance
    )
    after_card_spend = build_card_spend(after_months, after_sales_by_period)
    written.append(write_case(
        "case_operating_drop_after",
        after_card_sales,
        after_account_tx,
        closing_balance,
        after_card_spend,
        None,
        None,
        cb=RECOVERED_CB,
    ))

    for case_dir in written:
        names = sorted(os.listdir(case_dir))
        print("{:<28} {}".format(os.path.basename(case_dir), " ".join(names)))


if __name__ == "__main__":
    main()
