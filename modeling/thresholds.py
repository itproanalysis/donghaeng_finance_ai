"""임시 기준값 전부.

여기 있는 숫자는 전부 임시값이다. mock 기준으로 정한 것이고 데이터 근거가 없다.
실데이터가 쌓이면 조정한다. 코드 곳곳에 숫자를 흩지 않는다.

규칙이 문서에 적힌 값은 그 문서를 가리키고, 문서에 없이 구현하며 정한 값은
`문서에 없음`이라고 적어 둔다.
"""

# 기간. 3개월 비교와 6개월 창의 길이
RECENT_MONTHS = 3
PRIOR_MONTHS = 3
TREND_MONTHS = 6

# 임시값. 버틸 수 있는 일수를 낼 때 한 달을 며칠로 볼지. 문서에 없음
DAYS_PER_MONTH = 30

# 반복 출금 묶는 규칙. 날짜 차이 ±3일, 금액 차이 ±10%로 연속 3개월 이상
RECURRING_DAY_TOLERANCE = 3
RECURRING_AMOUNT_TOLERANCE = 0.10
RECURRING_MIN_OCCURRENCES = 3

# 정산 지연. 카드 결제액과 계좌 입금액을 맞춰 볼 때의 금액 오차와 최대 지연일
SETTLEMENT_AMOUNT_TOLERANCE = 0.05
SETTLEMENT_MAX_LAG_DAYS = 30

# 임시값. 성수기 진술을 대조할 때 실제 매출 상위 몇 달까지 볼지. 문서에 없음
SEASONALITY_TOP_MONTHS = 3
# 임시값. 상위 달 평균이 전체 평균의 이 배수를 넘어야 성수기가 있다고 본다.
# 매출이 평탄하면 상위 3개월은 잔흔들림이라 진술과 대조할 대상이 못 된다. 문서에 없음
SEASONALITY_PEAK_RATIO = 1.20
# 임시값. 계절로 몰린 폭이 12개월 추세로 설명되는 폭의 이 배수를 넘어야 성수기로 본다.
# 매출이 내내 줄어든 가게의 상위 3개월은 성수기가 아니라 덜 나빴던 과거다. 문서에 없음
SEASONALITY_PEAK_OVER_TREND = 1.0

# 임시값. 주중을 무슨 요일로 볼지. 월요일 0, 일요일 6. 문서에 없음
WEEKDAY_DOW = (0, 1, 2, 3, 4)

# 조건부 질문이 나오는 경계
TRIGGER_OPERATING_DAY_CHANGE = -0.15
TRIGGER_RECURRING_OUTFLOW_GROWTH = 0.10
TRIGGER_LOW_BALANCE_DAY_COUNT = 3
TRIGGER_PURCHASE_SPEND_GROWTH = 0.20
# 업종 평균보다 확실히 높은 쪽을 고르려고 정한 값. 온라인 음식서비스 거래액을
# 음식점 및 주점업 총매출로 나누면 업종 평균이 20% 안팎이다. 근거는 SCORECARD.md
TRIGGER_DELIVERY_SHARE = 0.30
TRIGGER_WEEKDAY_SHARE_CHANGE = 0.10

# 임시값. 배달 비중 질문을 최근 몇 개월로 볼지. 문서에 없음
TRIGGER_DELIVERY_WINDOW_MONTHS = 3

# 매출 하락 원인 구분. 임시값. 문서에 규칙이 없어 여기서 정함
# 매출이 이만큼 아래로 내려갔을 때만 원인을 분해한다
DECOMPOSE_SALES_DROP_MAX = -0.05
# 영업일 변화가 이 아래이고 영업일당 매출이 평평하면 영업일을 원인으로 본다
DECOMPOSE_OPERATING_DAY_CHANGE_MAX = -0.10
DECOMPOSE_SALES_PER_DAY_FLAT_ABS = 0.05
# 손님 수와 1인당 결제액 중 더 많이 내려간 쪽이 이만큼 앞서야 그쪽을 원인으로 본다
DECOMPOSE_COUNT_TICKET_MARGIN = 0.05

# imp_ 합성에 쓰는 방향 신호 경계. 전부 임시값이고 문서에 없음
# 각 항목은 (아래로 -1이 되는 값, 위로 +1이 되는 값)
SIGNAL_SALES_GROWTH = (-0.05, 0.05)
SIGNAL_CASHFLOW_SLOPE = (0.0, 0.0)
SIGNAL_BALANCE_GROWTH = (-0.05, 0.05)
SIGNAL_POSITIVE_MONTH_RATIO = (0.5, 0.8)
SIGNAL_DEFICIT_MONTH_COUNT = (1, 3)
SIGNAL_RECOVERY_FROM_TROUGH = (0.05, 0.30)
SIGNAL_REPEAT_CUSTOMER_RATIO = (0.20, 0.40)
SIGNAL_BOOKING_VALUE_TO_SALES = (0.30, 1.00)
SIGNAL_BOOKING_COVERAGE_WEEKS = (4, 8)
SIGNAL_GOAL_STRETCH_RATIO = (1.5, 2.0)
SIGNAL_PLAN_BUDGET_TO_CASHFLOW = (1.0, 2.0)

# 업종 계절성이 이 값 이상이면 계절 질문의 답을 반드시 받는다.
# peer_benchmark.json에서 값이 있는 9개 업종의 계절성은 0.107~0.136에 여섯,
# 0.206~0.230에 셋으로 나뉘고 그 사이가 비어 있다. 빈 구간의 가운데로 잡았다
EXT_SEASONALITY_QUESTION_MIN = 0.17

# 스코어카드 구간 경계. docs/SCORECARD.md
AXIS_ITEM_POINTS = 20

SC_CASHFLOW_TO_SALES = (0.0, 0.10)
# 6개월 중 흑자였던 달을 비율로 옮긴 값. 6/6, 4/6, 2/6
SC_POSITIVE_MONTH_RATIO = (2.0 / 6.0, 4.0 / 6.0, 1.0)
SC_LOW_BALANCE_DAYS_PER_MONTH = (0, 2, 5)
# 부채가 있는 소상공인의 매출 대비 월 상환 부담을 견줘 정했다. 근거는 SCORECARD.md
SC_DEBT_TO_SALES = (0.10, 0.20, 0.30)
SC_CASH_BUFFER_DAYS = (15, 30, 60)

SC_SALES_GROWTH_UP = 0.05
SC_SALES_GROWTH_FLAT = -0.05
SC_DRAWDOWN_NEAR_PEAK = 0.10
SC_RECOVERY_IN_PROGRESS = 0.30
SC_COST_HEADROOM = (0.15, 0.30)
# 임시값. "반복 출금이 거의 전부"로 볼 경계. 문서에 없음
SC_COST_HEADROOM_ALL_RECURRING = 0.05
SC_GOAL_STRETCH_OK = 1.5
SC_PLAN_BUDGET_OK = 1.0
SC_SALES_CV_SUSPEND = 0.50

# 매출 방향 항목에서 "해소됨"으로 볼 사유. docs/SCORECARD.md
RESOLVABLE_OPERATING_DAY_REASONS = ("건강", "가족", "일손")
ONGOING_OPERATING_DAY_REASONS = ("수요 감소", "사업 축소")

# 해소됐다는 답을 데이터로 대조할 수 있는 사유. 사람을 새로 썼으면 반복 출금이 늘어난다.
# 건강과 가족 일은 거래 데이터에 남지 않아 대조할 것이 없다
DATA_CHECKED_OPERATING_DAY_REASON = "일손"
# 임시값. 사람을 새로 썼다고 볼 반복 출금 증가율. 문서에 없음
RESOLVED_LABOR_RECURRING_GROWTH_MIN = 0.05

# 원인 구분 결과에 대응하는 목표 피처. 임시값. 문서에 매핑이 없어 여기서 정함
DRIVER_GOAL_FEATURE = {
    "count": "ops_transaction_count_avg_3m",
    "ticket": "ops_avg_ticket_3m",
    "operating_day": "biz_operating_day_count_avg_3m",
}

# 원인 구분 결과에 대응하는 own_primary_problem 보기. 임시값. 문서에 매핑이 없음
# 원인이 영업일일 때 맞는 보기가 own_primary_problem에 없어 비워 둔다
DRIVER_PRIMARY_PROBLEM = {
    "count": "손님 감소",
    "ticket": "단가 압박",
}
