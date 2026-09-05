"""인터뷰 피처 30개.

보기 매핑은 인터뷰 쪽 몫이고 여기는 매핑된 값만 받는다. 값이 없으면 0으로 채우지
않고 상태 문자열을 그대로 남긴다. interview.json 자체가 없으면 30개 전부 MISSING.
"""

from ..common import MISSING

# 데이터를 보고 추가로 묻는 것 7개
FOLLOW_UP_NAMES = (
    "own_operating_day_drop_reason",
    "own_operating_day_drop_resolved_flag",
    "own_fixed_cost_increase_reason",
    "own_low_balance_coping_method",
    "own_purchase_increase_reason",
    "ops_platform_fee_ratio",
    "biz_hall_customer_decline_flag",
)

# 앞으로 확정된 것 3개, 계절 2개, 가계 2개, 지금 상황 2개
CONTEXT_NAMES = (
    "own_confirmed_order_value",
    "own_booking_coverage_weeks",
    "own_confirmed_order_deposit_flag",
    "own_seasonality_direction",
    "own_peak_months",
    "own_essential_expense",
    "own_buffer_months",
    "own_primary_problem",
    "ops_repeat_customer_ratio",
)

# 목표 4개, 계획 5개, 전에 해본 것 3개, 자금 2개
GOAL_AND_PLAN_NAMES = (
    "own_goal_evidence_feature",
    "own_goal_target_value",
    "own_goal_horizon_days",
    "own_goal_self_selected_flag",
    "own_plan_action_category",
    "own_plan_horizon_days",
    "own_plan_budget",
    "own_plan_blockers",
    "own_plan_top_blocker",
    "own_prior_action_type",
    "own_prior_action_result",
    "own_prior_action_ongoing_flag",
    "own_fund_purpose",
    "own_fund_amount",
)

FEATURE_NAMES = FOLLOW_UP_NAMES + CONTEXT_NAMES + GOAL_AND_PLAN_NAMES

# 피처가 아니라 조합 피처의 재료로만 쓰는 답
NON_FEATURE_KEYS = ("stated_monthly_sales", "evidence_text")


def compute(answers):
    if answers is None:
        answers = {}
    return {name: answers.get(name, MISSING) for name in FEATURE_NAMES}


def raw_material(answers, key):
    """피처가 아닌 인터뷰 답. 진술 매출처럼 조합 피처가 쓰는 값."""
    if answers is None:
        return MISSING
    return answers.get(key, MISSING)
