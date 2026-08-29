"""CB 심사 의견 옆에 붙일 값. 문장은 만들지 않는다. 문장 생성은 화면 쪽 몫.

업종 벤치마크 대조도 여기 붙는다. 화면에 나란히 놓는 재료일 뿐 점수에는 안 들어간다.
"""

import json
import sys

from .build import build, case_path


def contrast(case_id):
    features, aux = build(case_path(case_id))
    payload = {
        "cb_opinion": aux["cb"]["opinion"],
        "biz_industry_code": features["biz_industry_code"],
        "fin_sales_growth_3m": features["fin_sales_growth_3m"],
        "ops_transaction_count_avg_3m": features["ops_transaction_count_avg_3m"],
        "ops_count_growth_3m": features["ops_count_growth_3m"],
        "ops_avg_ticket_3m": features["ops_avg_ticket_3m"],
        "ops_ticket_growth_3m": features["ops_ticket_growth_3m"],
        "biz_operating_day_change_3m": features["biz_operating_day_change_3m"],
        "own_operating_day_drop_reason": features["own_operating_day_drop_reason"],
        "own_operating_day_drop_resolved_flag": features["own_operating_day_drop_resolved_flag"],
    }
    # 업종 평균과의 대조. 화면 재료이고 점수에는 들어가지 않는다
    payload.update(aux["external_context"])
    return payload


def main():
    import argparse

    parser = argparse.ArgumentParser(description="CB 심사 의견 옆에 붙일 대조 재료")
    parser.add_argument("case_ids", nargs="*")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    case_ids = args.case_ids or ["case_operating_drop"]
    if args.json:
        out = [contrast(case_id) for case_id in case_ids]
        print(json.dumps(out if len(out) > 1 else out[0], ensure_ascii=False, indent=2))
        return

    for case_id in case_ids:
        payload = contrast(case_id)
        print(case_id)
        for name, value in payload.items():
            print("  {:<38} {}".format(name, value))
        print()


if __name__ == "__main__":
    main()
