"""제출 서류 피처 6개."""

from datetime import date

from ..common import MISSING, is_number, ratio

# 업종 코드. docs/FEATURE_LIST.md 제출 서류 절의 11개와 같은 값
INDUSTRY_CODES = (
    "RESTAURANT",
    "CAFE",
    "OFFLINE_RETAIL",
    "ONLINE_SHOPPING",
    "BEAUTY",
    "ACADEMY",
    "LODGING",
    "AUTO_REPAIR",
    "INTERIOR",
    "TRANSPORT",
    "WHOLESALE_SMALL_MANUFACTURING",
)

FEATURE_NAMES = (
    "biz_industry_code",
    "biz_business_age_months",
    "biz_store_count",
    "fin_rent_to_sales_ratio",
    "fin_cash_sales_ratio",
    "fin_fixed_cost_ratio",
)


def compute(docs, sales_avg_3m, card_sales_total_12m, recurring_outflow_avg_3m, reference_date):
    """고정비는 계좌에서 잡은 반복 출금을 쓴다.

    서류에는 임대료밖에 없어 그것만 쓰면 임대료/매출과 같은 값이 된다.
    반복 출금에 임대료가 이미 들어 있으므로 따로 더하지 않는다.
    """
    vat = docs.get("vat_reported_sales_12m")
    cash_gap = MISSING
    if is_number(vat) and is_number(card_sales_total_12m):
        cash_gap = ratio(float(vat) - float(card_sales_total_12m), float(vat))

    return {
        "biz_industry_code": _industry_code(docs.get("industry")),
        "biz_business_age_months": _age_months(docs.get("open_date"), reference_date),
        "biz_store_count": docs.get("store_count", MISSING),
        "fin_rent_to_sales_ratio": ratio(docs.get("monthly_rent"), sales_avg_3m),
        "fin_cash_sales_ratio": cash_gap,
        "fin_fixed_cost_ratio": ratio(recurring_outflow_avg_3m, sales_avg_3m),
    }


def _industry_code(value):
    """11개 코드 안의 값만 쓴다. 밖의 값은 업종을 모르는 것으로 본다."""
    return value if value in INDUSTRY_CODES else MISSING


def _age_months(open_date_text, reference_date):
    if not open_date_text or not isinstance(reference_date, date):
        return MISSING
    opened = date.fromisoformat(open_date_text)
    months = (reference_date.year - opened.year) * 12 + (reference_date.month - opened.month)
    if reference_date.day < opened.day:
        months -= 1
    return months
