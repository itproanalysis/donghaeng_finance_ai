"""문서와 코드 대조.

문서를 믿지 않고 소스를 대조한다. 문서에 적힌 피처 이름이나 구간 경계 숫자를 하나만
바꿔도 여기서 깨진다. 데이터 담당의 verify_peer_benchmark_contract.py와 같은 방식이다.

두 가지를 본다.

- docs/FEATURE_LIST.md의 코드명 94개가 build.py의 FEATURE_ORDER와 같은지
- docs/SCORECARD.md의 항목과 구간 경계 숫자가 thresholds.py와 같은지

표준 라이브러리만 쓴다.
"""

import os
import re

from . import thresholds as T
from .build import FEATURE_ORDER
from .scorecard import BANDS

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FEATURE_LIST = os.path.join(ROOT, "docs", "FEATURE_LIST.md")
SCORECARD = os.path.join(ROOT, "docs", "SCORECARD.md")

# 피처 코드명의 앞머리. 뒤에 이름이 붙어야 피처이고, 앞머리만 있으면 설명용이다
FEATURE_PREFIXES = ("fin_", "ops_", "biz_", "own_", "crd_", "imp_")

AXIS_HEADERS = ("축 1.", "축 2.")

# 항목마다 문서 구간에 반드시 나와야 하는 숫자. thresholds.py에서 만든다
def required_numbers():
    return {
        "매출 대비 남는 비율": {T.SC_CASHFLOW_TO_SALES[1] * 100},
        "흑자월 비율": {round(r * 6) for r in T.SC_POSITIVE_MONTH_RATIO},
        "잔액 부족일": set(T.SC_LOW_BALANCE_DAYS_PER_MONTH),
        "매출 대비 상환 부담": {v * 100 for v in T.SC_DEBT_TO_SALES},
        "버틸 수 있는 일수": set(T.SC_CASH_BUFFER_DAYS),
        "매출 방향": {T.SC_SALES_GROWTH_UP * 100, abs(T.SC_SALES_GROWTH_FLAT) * 100},
        "저점 회복": {T.SC_DRAWDOWN_NEAR_PEAK * 100, T.SC_RECOVERY_IN_PROGRESS * 100},
        "잡혀 있는 계약": set(T.SIGNAL_BOOKING_COVERAGE_WEEKS),
        "비용 줄일 여지": ({v * 100 for v in T.SC_COST_HEADROOM}
                     | {T.SC_COST_HEADROOM_ALL_RECURRING * 100}),
        "계획의 현실성": {T.SC_GOAL_STRETCH_OK, T.SC_PLAN_BUDGET_OK,
                    T.SIGNAL_GOAL_STRETCH_RATIO[1]},
    }


# 구간을 사람이 읽게 풀어 쓰면서 생긴 숫자. 경계값이 아니라 경계에서 유도된 값이다.
# 이 목록이 낡아도 대조가 깨지므로 문서를 고치면 여기도 같이 고쳐야 한다
DERIVED_NUMBERS = {
    "매출 대비 남는 비율": {0.0},
    "흑자월 비율": {0.0, 1.0, 3.0, 5.0},
    "잔액 부족일": {1.0, 3.0, 6.0},
    "매출 대비 상환 부담": set(),
    "버틸 수 있는 일수": {29.0, 59.0},
    "매출 방향": set(),
    "저점 회복": set(),
    "잡혀 있는 계약": set(),
    "비용 줄일 여지": set(),
    "계획의 현실성": set(),
}


def doc_feature_names():
    """FEATURE_LIST.md의 백틱 안에서 피처 코드명을 모은다."""
    with open(FEATURE_LIST, encoding="utf-8") as handle:
        text = handle.read()
    found = re.findall(r"`([A-Za-z_][A-Za-z0-9_]*)`", text)
    return {name for name in found
            if name.startswith(FEATURE_PREFIXES) and not name.endswith("_")}


def doc_axis_tables():
    """SCORECARD.md의 두 축 표를 {항목: [(구간, 점수)]}로 읽는다.

    첫 열이 빈 행은 바로 앞 항목이 이어지는 행이다.
    """
    with open(SCORECARD, encoding="utf-8") as handle:
        lines = handle.read().splitlines()

    axes = {}
    for header in AXIS_HEADERS:
        rows, order, item, started = {}, [], None, False
        for line in lines:
            if line.startswith("## "):
                if started:
                    break
                started = header in line
                continue
            if not started or not line.startswith("|"):
                continue
            cells = [c.strip() for c in line.strip("|").split("|")]
            if len(cells) != 4 or cells[0] == "항목" or set(cells[0]) <= set("-: "):
                if cells and cells[0]:
                    continue
            if cells[0]:
                item = cells[0]
                rows[item] = []
                order.append(item)
            if item:
                rows[item].append((cells[2], cells[3]))
        axes[header] = (order, rows)
    return axes


def _numbers(text):
    return {float(n) for n in re.findall(r"\d+(?:\.\d+)?", text)}


def check_feature_names():
    """문서의 코드명과 FEATURE_ORDER가 정확히 같아야 한다."""
    doc = doc_feature_names()
    code = set(FEATURE_ORDER)
    only_doc = sorted(doc - code)
    only_code = sorted(code - doc)
    ok = not only_doc and not only_code and len(code) == 94
    note = "{}개 일치".format(len(code)) if ok else \
        "문서에만 {} / 코드에만 {}".format(only_doc[:4], only_code[:4])
    return ok, note


def check_axis_shape():
    """축마다 5항목이고 항목 이름이 코드의 구간 표와 같아야 한다."""
    axes = doc_axis_tables()
    doc_items = []
    problems = []
    for header, (order, rows) in axes.items():
        if len(order) != 5:
            problems.append("{} 항목 {}개".format(header, len(order)))
        doc_items += order
        for name in order:
            points = [p for _, p in rows[name] if p.isdigit()]
            if points and max(int(p) for p in points) != T.AXIS_ITEM_POINTS:
                problems.append("{} 만점 {}".format(name, max(points)))
    missing = sorted(set(BANDS) - set(doc_items))
    extra = sorted(set(doc_items) - set(BANDS))
    if missing or extra:
        problems.append("코드에만 {} / 문서에만 {}".format(missing, extra))
    return not problems, "{}".format(problems) if problems else \
        "축마다 5항목, 만점 {}점, 이름 10개 일치".format(T.AXIS_ITEM_POINTS)


def check_band_numbers():
    """문서 구간의 숫자와 thresholds.py의 경계가 같아야 한다."""
    axes = doc_axis_tables()
    rows = {}
    for _order, table in axes.values():
        rows.update(table)

    required = required_numbers()
    problems = []
    for name, wanted in required.items():
        if name not in rows:
            problems.append("{} 표에 없음".format(name))
            continue
        seen = set()
        for band, _points in rows[name]:
            seen |= _numbers(band)
        absent = sorted(wanted - seen)
        if absent:
            problems.append("{}: 문서에 없는 경계 {}".format(name, absent))
        unexplained = sorted(seen - wanted - DERIVED_NUMBERS.get(name, set()))
        if unexplained:
            problems.append("{}: 근거 없는 숫자 {}".format(name, unexplained))
    total = sum(len(v) for v in required.values())
    return not problems, "{}".format(problems[:3]) if problems else \
        "경계 {}개가 문서와 일치".format(total)


CHECKS = (
    ("FEATURE_LIST 코드명 94개", check_feature_names),
    ("SCORECARD 항목과 만점", check_axis_shape),
    ("SCORECARD 구간 경계 숫자", check_band_numbers),
)


def run():
    return [(name,) + check() for name, check in CHECKS]


def main():
    results = run()
    for name, passed, note in results:
        print("  [{}] {:<28} {}".format("PASS" if passed else "FAIL", name, note))
    raise SystemExit(0 if all(r[1] for r in results) else 1)


if __name__ == "__main__":
    main()
