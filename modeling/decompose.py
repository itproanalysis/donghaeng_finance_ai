"""매출 하락의 원인 구분. 손님 수, 1인당 결제액, 영업일 중 무엇이 하락의 원인인지.

docs/SCORECARD.md의 매출 방향 항목과 imp_goal_data_alignment가 이 결과를 쓴다.
규칙이 두 문서에 없어 여기서 정했고 경계값은 전부 thresholds.py에 있다.

영업일을 먼저 본다. 문 연 날이 줄었는데 영업일당 매출이 그대로면 하락은 날짜에서
온 것이라 건수가 같이 줄어 있어도 영업일을 원인으로 본다.
"""

from . import thresholds as T
from .common import is_number

COUNT = "count"
TICKET = "ticket"
OPERATING_DAY = "operating_day"
MIXED = "mixed"
NOT_DECLINING = "not_declining"
UNKNOWN = "unknown"


def sales_drop_driver(features, aux):
    """피처 dict와 보조값을 받아 하락의 원인을 낸다."""
    sales_growth = features.get("fin_sales_growth_3m")
    if not is_number(sales_growth):
        return UNKNOWN
    if sales_growth > T.DECOMPOSE_SALES_DROP_MAX:
        return NOT_DECLINING

    day_change = features.get("biz_operating_day_change_3m")
    per_day_growth = aux.get("sales_per_operating_day_growth_3m")
    if (is_number(day_change) and is_number(per_day_growth)
            and day_change <= T.DECOMPOSE_OPERATING_DAY_CHANGE_MAX
            and abs(per_day_growth) <= T.DECOMPOSE_SALES_PER_DAY_FLAT_ABS):
        return OPERATING_DAY

    count_growth = features.get("ops_count_growth_3m")
    ticket_growth = features.get("ops_ticket_growth_3m")
    if not is_number(count_growth) or not is_number(ticket_growth):
        return MIXED
    if count_growth <= ticket_growth - T.DECOMPOSE_COUNT_TICKET_MARGIN:
        return COUNT
    if ticket_growth <= count_growth - T.DECOMPOSE_COUNT_TICKET_MARGIN:
        return TICKET
    return MIXED
