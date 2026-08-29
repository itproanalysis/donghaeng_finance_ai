"""6개월 뒤 재평가. build.py를 그대로 다시 돌려 목표 피처의 전, 후, 목표값을 낸다.

재평가용 별도 계산 함수를 만들지 않는다.
"""

from .build import build, case_path
from .common import MISSING, is_number

BEFORE = "case_operating_drop"
AFTER = "case_operating_drop_after"


def compare(before_case=BEFORE, after_case=AFTER):
    before, _ = build(case_path(before_case))
    after, _ = build(case_path(after_case))
    goal_feature = before["own_goal_evidence_feature"]
    target = before["own_goal_target_value"]
    result = {
        "before_case": before_case,
        "after_case": after_case,
        "goal_feature": goal_feature,
        "before": before[goal_feature],
        "after": after[goal_feature],
        "target": target,
        "horizon_days": before["own_goal_horizon_days"],
    }
    reached = MISSING
    if is_number(result["after"]) and is_number(target):
        reached = bool(float(result["after"]) >= float(target))
    result["reached"] = reached
    return result


def main():
    import argparse
    import json

    parser = argparse.ArgumentParser(description="6개월 뒤 재평가")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    row = compare()
    if args.json:
        print(json.dumps(row, ensure_ascii=False, indent=2))
        return

    print("{:<32} {:>10} {:>10} {:>10}".format("목표 피처", "전", "후", "목표값"))
    print("{:<32} {:>10.3f} {:>10.3f} {:>10}".format(
        row["goal_feature"], row["before"], row["after"], row["target"]))
    print()
    print("목표 기간 {}일, 목표 {}".format(
        row["horizon_days"],
        {True: "달성", False: "미달"}.get(row["reached"], row["reached"])))


if __name__ == "__main__":
    main()
