"""업종 벤치마크 연결.

데이터 담당이 만든 external-data/peer_benchmark.json에서 업종별 12필드를 읽는다.
파일이 없어도 돌아야 한다. 두 브랜치의 머지 순서와 무관하게 같은 코드가 동작해야
하기 때문이다.

여기서 읽은 값은 화면에 붙일 대조 재료로만 쓰고 피처 94개에도 점수에도 넣지 않는다.
데이터 담당의 계약도 12필드 전부 context_only다.
"""

import json
import os

from . import thresholds as T
from .common import MISSING, is_number

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BENCHMARK_PATH = os.path.join(ROOT, "external-data", "peer_benchmark.json")

# 12필드. 데이터 담당의 peer_benchmark.json과 이름, 순서가 같다
EXT_FIELDS = (
    "ext_peer_sales_growth_3m",
    "ext_peer_sales_volatility_6m",
    "ext_peer_marketing_cost_ratio",
    "ext_peer_fixed_cost_ratio",
    "ext_peer_repeat_customer_ratio",
    "ext_sales_growth_gap_peer",
    "ext_cost_ratio_gap_peer",
    "ext_foot_traffic_change_3m",
    "ext_competitor_count_change_6m",
    "ext_industry_growth_6m",
    "ext_industry_volatility_12m",
    "ext_industry_seasonality",
)

# 절대 수준을 판단 재료로 쓰지 않는 필드. 업종 지수의 변동성이라 가게 한 곳의
# 변동성과 같은 자로 잴 수 없다. 개별 가게의 오르내림은 업종 평균에서 상쇄된다
LEVEL_NOT_COMPARABLE = (
    "ext_peer_sales_volatility_6m",
    "ext_industry_volatility_12m",
)


def all_missing():
    return {name: MISSING for name in EXT_FIELDS}


def source_available(path=None):
    return os.path.exists(path or BENCHMARK_PATH)


def load(industry_code, path=None):
    """업종 코드로 12필드를 읽는다.

    파일이 없거나, 업종이 표에 없거나, 값이 null이면 MISSING이다. 외부의 null과
    내부의 MISSING을 1:1로 옮기고 0으로 채우지 않는다. 비어 있다는 사실 자체가
    CB가 못 보는 자리를 가리키는 재료다.
    """
    target = path or BENCHMARK_PATH
    if not os.path.exists(target):
        return all_missing()
    with open(target, encoding="utf-8") as handle:
        payload = json.load(handle)
    table = payload.get("benchmarks", {})
    row = table.get(industry_code) if isinstance(industry_code, str) else None
    if not isinstance(row, dict):
        return all_missing()
    return {name: (row[name] if is_number(row.get(name)) else MISSING)
            for name in EXT_FIELDS}


def sales_growth_gap(sales_growth_3m, external):
    """이 가게의 3개월 매출 증가율과 업종 평균의 차이.

    데이터 담당의 계약에서 ext_sales_growth_gap_peer는 사장님 값이 있어야 계산되는
    자리라 파일에서는 항상 null이다. 그 자리를 여기서 채운다.
    """
    peer = external.get("ext_peer_sales_growth_3m")
    if not is_number(sales_growth_3m) or not is_number(peer):
        return MISSING
    return float(sales_growth_3m) - float(peer)


def seasonality_question_required(external):
    """업종의 계절성이 경계 이상이면 계절 질문의 답을 반드시 받아야 한다.

    성수기 질문은 항상 묻는 문항에 이미 들어 있다. 이 값은 그 답을 비워 두면 안 되는
    업종인지를 가린다. 조건부 질문 6개와는 별개다.
    """
    value = external.get("ext_industry_seasonality")
    if not is_number(value):
        return MISSING
    return float(value) >= T.EXT_SEASONALITY_QUESTION_MIN


def context(features, external):
    """화면에 붙일 대조 재료. 점수에 넣지 않는다."""
    return {
        "ext_peer_sales_growth_3m": external.get("ext_peer_sales_growth_3m"),
        "ext_sales_growth_gap_peer": sales_growth_gap(
            features.get("fin_sales_growth_3m"), external),
        "ext_industry_growth_6m": external.get("ext_industry_growth_6m"),
        "ext_industry_seasonality": external.get("ext_industry_seasonality"),
        "seasonality_question_required": seasonality_question_required(external),
    }


def main():
    from .build import MOCK_DIR, build, case_path
    import sys

    print("벤치마크 파일 {}".format("있음" if source_available() else "없음, 전부 MISSING"))
    case_ids = sys.argv[1:] or sorted(os.listdir(MOCK_DIR))
    for case_id in case_ids:
        features, aux = build(case_path(case_id))
        external = aux["external"]
        filled = sum(1 for v in external.values() if is_number(v))
        print("{:<28} 업종 {:<12} 값 {}개 / {}".format(
            case_id, features["biz_industry_code"], filled, len(EXT_FIELDS)))
        for name, value in aux["external_context"].items():
            print("  {:<32} {}".format(name, value))
        print()


if __name__ == "__main__":
    main()
