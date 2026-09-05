"""값 → 백분위 역조회. 인터뷰 중 서비스가 호출한다.

사장님이 "대출 5천만원 있어요"라고 말하면 그 값이 표본 안에서 어디쯤인지 돌려준다.
연령대를 함께 주면 또래 대비 위치도 같이 낸다.

    python3 scripts/credit_position_lookup.py --demo
    python3 scripts/credit_position_lookup.py crd_total_debt 50000 --age 40대
"""
import argparse
import bisect
import json
from pathlib import Path

# 이 스크립트는 두 곳에서 실행된다 — 데이터 저장소의 scripts/와 앱 저장소의 external-data/.
# 같은 폴더에 artifact가 있으면 그걸 쓰고, 없으면 데이터 저장소 레이아웃을 찾는다.
HERE = Path(__file__).resolve().parent
ARTIFACT = next((p for p in (HERE / "credit_position.json",
                             HERE.parent / "data" / "processed" / "credit_position.json")
                 if p.exists()), HERE / "credit_position.json")

_cache = None


def load():
    global _cache
    if _cache is None:
        _cache = json.loads(ARTIFACT.read_text(encoding="utf-8"))
    return _cache


def _percentile_from_grid(grid, value):
    """격자에서 값의 백분위. grid[i] = 하위 i% 경계값(오름차순)."""
    # 같은 값이 여러 칸에 걸치면(동점) 그 구간의 중앙을 쓴다.
    low = bisect.bisect_left(grid, value)
    high = bisect.bisect_right(grid, value)
    if low >= len(grid):
        return 100
    if high == low:                       # 격자에 없는 값 → 삽입 위치가 곧 백분위
        return low
    return (low + high - 1) // 2


def lookup(metric, value, age_band=None):
    """metric의 value가 어디쯤인지. 바닥 과잉 지표는 조건부 분포로 갈아탄다."""
    data = load()
    if metric not in data["metrics"]:
        raise KeyError(f"알 수 없는 지표: {metric}. "
                       f"가능한 값: {', '.join(data['metrics'])}")
    meta = data["metrics"][metric]

    def position(block, scope, n):
        # 코호트 조회는 코호트 자신의 바닥 분포를 쓴다. 전체 블록을 참조하면
        # 또래 위치가 전체 위치와 같은 값으로 나온다.
        floor = block.get("floor_inflated")
        # 바닥 과잉 지표에서 바닥값이면 백분위 대신 '동일 집단 비율'로 답한다.
        if floor and value <= floor["floor_value"]:
            return {
                "scope": scope,
                "n": n,
                "mode": "floor_group",
                "percentile": None,
                "at_floor_share": floor["at_floor_share"],
                "statement": f"{scope} 표본의 {floor['at_floor_share']:.0%}가 동일하다",
            }
        grid = block.get("percentile_grid")
        if floor and floor.get("conditional_percentile_grid"):
            grid = floor["conditional_percentile_grid"]
            scope_note = f"{scope} · {floor['floor_value']} 초과 집단 내"
            n = floor["above_floor_n"]
        else:
            scope_note = scope
        if not grid:
            return None
        pct = _percentile_from_grid(grid, value)
        reference = (floor["conditional_distribution"]
                     if floor and floor.get("conditional_percentile_grid")
                     else block.get("distribution"))
        return {
            "scope": scope_note,
            "n": n,
            "mode": "percentile",
            "percentile": pct,
            "statement": f"{scope_note} 하위 {pct}% — {scope_note}의 {pct}%가 이보다 낮다",
            "reference": ({k: reference[k] for k in ("p10", "p25", "p50", "p75", "p90")}
                          if reference else None),
        }

    result = {
        "metric": metric,
        "value": value,
        "정의": meta["정의"],
        "단위": meta["단위"],
        "direction": meta["direction"],
        "overall": position(meta, "전체", meta["n"]),
        "source_status": data["status"],
    }

    if age_band:
        bands = data["by_age_band"]
        if age_band not in bands:
            result["age_band"] = {"error": f"코호트 없음. 가능: {', '.join(bands)}"}
        else:
            block = bands[age_band]["metrics"][metric]
            result["age_band"] = {
                "band": age_band,
                **(position(block, age_band, block["n"]) or {}),
            }
    return result


def assess(direction, percentile):
    """백분위 자체는 값의 크기 순서일 뿐이다. 좋고 나쁨은 direction이 정한다.

    '상위 n%'라는 표현은 쓰지 않는다. 신용 이력 개월수처럼 클수록 좋은 지표에서
    값이 작으면 '하위'인데, 이를 '상위 96%'로 뒤집어 부르면 양호하다는 뜻으로 읽힌다.
    """
    if direction == "context_only":
        return "중립 지표 — 그 자체로 좋고 나쁨을 말하지 않는다"
    worse_when_high = direction == "negative_is_improvement"
    heavy = percentile >= 75
    light = percentile <= 25
    if worse_when_high:
        return ("부담이 큰 쪽" if heavy else "부담이 작은 쪽" if light else "중간 구간")
    return ("두터운 쪽" if heavy else "얇은 쪽" if light else "중간 구간")


def narrate(result):
    """인터뷰 화면에 쓸 한 문단. 판정이 아니라 위치만 말한다."""
    unit = result["단위"]
    value = result["value"]
    shown = f"{value:,.0f}" if abs(value) >= 1 else f"{value}"
    lines = [f"{result['정의']}: {shown} {unit}"]

    for key, prefix in (("overall", ""), ("age_band", "또래 ")):
        block = result.get(key)
        if not block or "mode" not in block:
            continue
        label = prefix if key == "overall" else f"또래({block['band']}) "
        if block["mode"] == "floor_group":
            lines.append(f"  {label}{block['statement']} — 변별 구간이 아니다")
            continue
        lines.append(f"  {label}{block['statement']}  "
                     f"({assess(result['direction'], block['percentile'])}, n={block['n']})")
        ref = block.get("reference")
        if ref and key == "overall":
            lines.append(f"    참조  p25 {ref['p25']:,} / p50 {ref['p50']:,} / p75 {ref['p75']:,}")
    return "\n".join(lines)


DEMO = [
    ("crd_total_debt", 50000, "40대"),
    ("crd_total_debt", 5000, "30대"),
    ("crd_high_interest_debt", 0, None),
    ("crd_high_interest_debt", 12000, "50대"),
    ("crd_delinquency_count_12m", 0, None),
    ("crd_delinquency_count_12m", 2, None),
    ("crd_lender_count", 4, "40대"),
    ("crd_credit_history_months", 18, "30대"),
]


def main():
    parser = argparse.ArgumentParser(description="신용 포지션 백분위 조회")
    parser.add_argument("metric", nargs="?")
    parser.add_argument("value", nargs="?", type=float)
    parser.add_argument("--age", dest="age_band")
    parser.add_argument("--demo", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    data = load()
    if args.demo:
        print(f"[{data['dataset_id']} v{data['version']}  status={data['status']}]")
        print(f"{data['critical_caveat']}\n")
        for metric, value, band in DEMO:
            print(narrate(lookup(metric, value, band)))
            print()
        return

    if not args.metric or args.value is None:
        parser.error("metric과 value를 주거나 --demo를 쓰라")
    result = lookup(args.metric, args.value, args.age_band)
    print(json.dumps(result, ensure_ascii=False, indent=2) if args.json else narrate(result))


if __name__ == "__main__":
    main()
