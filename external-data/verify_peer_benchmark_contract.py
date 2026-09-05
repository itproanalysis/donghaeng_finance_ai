"""peer_benchmark.json이 이 앱의 실제 계약과 맞는지 대조한다.

문서를 믿지 않고 src/domain의 TypeScript 소스를 직접 파싱해서 비교한다.
계약이 바뀌면 여기서 먼저 깨져야 한다.

    python3 external-data/verify_peer_benchmark_contract.py

표준 라이브러리만 쓴다. 저장소 루트를 스스로 찾으므로 어느 위치에서 실행해도 된다.
"""
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ARTIFACT = HERE / "peer_benchmark.json"
DEFAULT_APP = HERE.parent

PIPELINE = "src/domain/improvement-feature-pipeline.ts"
CATALOG = "src/domain/soho-industry-catalog.ts"

# 단위 계약. 전부 0-1 소수이며 퍼센트 표기를 허용하지 않는다.
# 비중은 [0, 1], 변화율·변동성은 부호가 있으므로 |v| <= 1.
RATIO_FIELDS = {
    "ext_peer_marketing_cost_ratio",
    "ext_peer_fixed_cost_ratio",
    "ext_peer_repeat_customer_ratio",
}
RATE_FIELDS = {
    "ext_peer_sales_growth_3m",
    "ext_peer_sales_volatility_6m",
    "ext_sales_growth_gap_peer",
    "ext_cost_ratio_gap_peer",
    "ext_foot_traffic_change_3m",
    "ext_competitor_count_change_6m",
    "ext_industry_growth_6m",
    "ext_industry_volatility_12m",
    "ext_industry_seasonality",
}


def fail(msg):
    print(f"  FAIL  {msg}")
    return 1


def ok(msg):
    print(f"  ok    {msg}")
    return 0


def parse_interface_fields(source: str) -> list[str]:
    """ExternalContextFeatureInput 본문에서 필드명을 선언 순서대로 뽑는다."""
    match = re.search(
        r"export interface ExternalContextFeatureInput\s*\{(.*?)\n\}", source, re.S
    )
    if not match:
        raise LookupError("ExternalContextFeatureInput 선언을 찾지 못했다")
    return re.findall(r"^\s*(ext_\w+)\??\s*:", match.group(1), re.M)


def parse_industry_codes(source: str) -> list[str]:
    """SohoIndustryCode 유니온에서 코드를 선언 순서대로 뽑는다."""
    match = re.search(r"export type SohoIndustryCode\s*=(.*?);", source, re.S)
    if not match:
        raise LookupError("SohoIndustryCode 선언을 찾지 못했다")
    return re.findall(r'"([A-Z_]+)"', match.group(1))


def main() -> int:
    app = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_APP
    artifact = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    benchmarks = artifact["benchmarks"]
    errors = 0

    print(f"artifact  {ARTIFACT.name}  v{artifact['version']}")

    print("\n[구조]")
    for code, row in benchmarks.items():
        nulls = sum(1 for v in row.values() if v is None)
        bad = {k: v for k, v in row.items()
               if v is not None and not isinstance(v, (int, float))}
        if bad:
            errors += fail(f"{code}: 숫자·null이 아닌 값 {bad}")
    if not errors:
        errors += ok(f"{len(benchmarks)}개 업종 전부 값이 float 또는 null")

    # 결측을 0으로 채우지 않았는지. 0.0은 유효값일 수 있으나 v0에선 나올 수 없다.
    zeros = [(c, f) for c, row in benchmarks.items()
             for f, v in row.items() if v == 0]
    if zeros:
        errors += fail(f"결측을 0으로 채운 흔적: {zeros}")
    else:
        errors += ok("결측을 0으로 대체하지 않음")

    # 단위 계약. 31.5(퍼센트)를 0.315(소수) 대신 넣는 실수를 잡는다.
    # 이 값들은 fin_* 소수와 직접 비교되므로 100배 어긋나도 조용히 통과한다.
    out_of_range = []
    for code, row in benchmarks.items():
        for field, value in row.items():
            if value is None:
                continue
            if field in RATIO_FIELDS and not 0 <= value <= 1:
                out_of_range.append((code, field, value, "[0, 1]"))
            elif field in RATE_FIELDS and abs(value) > 1:
                out_of_range.append((code, field, value, "|v| <= 1"))
    if out_of_range:
        for code, field, value, rule in out_of_range:
            errors += fail(f"{code}.{field} = {value} 가 {rule} 밖이다. "
                           f"퍼센트를 소수로 바꾸지 않았는지 확인하라 (31.5 → 0.315)")
    else:
        errors += ok("모든 값이 0–1 소수 범위. 퍼센트 혼입 없음")

    unclassified = set(artifact["lineage"]["fields"]) - RATIO_FIELDS - RATE_FIELDS
    if unclassified:
        errors += fail(f"단위 규칙이 정의되지 않은 필드: {sorted(unclassified)}")

    # 런타임 파생 필드는 항상 null이어야 한다.
    runtime = [f for f, meta in artifact["lineage"]["fields"].items()
               if meta["상태"] == "런타임파생_주입금지"]
    leaked = [(c, f) for c, row in benchmarks.items()
              for f in runtime if row[f] is not None]
    if leaked:
        errors += fail(f"런타임 파생 필드에 값이 들어감: {leaked}")
    else:
        errors += ok(f"런타임 파생 필드 {len(runtime)}개 전부 null ({', '.join(runtime)})")

    print(f"\n[앱 계약 대조]  {app}")
    pipeline_path = app / PIPELINE
    catalog_path = app / CATALOG
    if not pipeline_path.exists() or not catalog_path.exists():
        print(f"  skip  {PIPELINE} / {CATALOG}를 찾을 수 없다.")
        print(f"\n{'FAIL' if errors else 'PASS'}  (구조 검사만 수행)")
        return 1 if errors else 0

    app_fields = parse_interface_fields(pipeline_path.read_text(encoding="utf-8"))
    app_codes = parse_industry_codes(catalog_path.read_text(encoding="utf-8"))

    ours_fields = artifact["lineage"]["fields"].keys()
    for code, row in benchmarks.items():
        if list(row.keys()) != app_fields:
            missing = set(app_fields) - set(row)
            extra = set(row) - set(app_fields)
            errors += fail(f"{code} 필드 불일치 (누락 {missing or '없음'}, 초과 {extra or '없음'})")
            break
    else:
        errors += ok(f"12필드 이름·순서가 ExternalContextFeatureInput과 일치 ({len(app_fields)}개)")

    if list(benchmarks.keys()) != app_codes:
        missing = set(app_codes) - set(benchmarks)
        extra = set(benchmarks) - set(app_codes)
        errors += fail(f"업종 enum 불일치 (누락 {missing or '없음'}, 초과 {extra or '없음'})")
    else:
        errors += ok(f"업종 코드·순서가 SohoIndustryCode와 일치 ({len(app_codes)}개)")

    if set(ours_fields) != set(app_fields):
        errors += fail("lineage에 기록되지 않은 필드가 있다")
    else:
        errors += ok("12필드 전부 lineage 기록 보유")

    print(f"\n{'FAIL' if errors else 'PASS'}  "
          f"coverage {artifact['coverage']['filled']}/{artifact['coverage']['total_slots']} "
          f"({artifact['coverage']['filled_pct']}%)")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
