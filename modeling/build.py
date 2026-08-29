"""케이스 하나를 받아 피처 94개를 산출한다.

소스 순서대로 계산하고 뒤 소스가 앞 결과를 재료로 받는다. 인터뷰 파일이 없으면
인터뷰 피처 30개를 전부 MISSING으로 낸다. 재평가 케이스도 이 함수를 그대로 쓴다.
"""

import json
import os
import sys

import pandas as pd

from . import external
from .common import MISSING, is_state
from .features import account, card_sales, card_spend, cb, combined, documents, interview

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MOCK_DIR = os.path.join(ROOT, "data", "mock")

FEATURE_ORDER = (
    card_sales.FEATURE_NAMES
    + account.FEATURE_NAMES
    + card_spend.FEATURE_NAMES
    + documents.FEATURE_NAMES
    + cb.FEATURE_NAMES
    + interview.FEATURE_NAMES
    + combined.FEATURE_NAMES
)

SOURCE_OF = {}
for _names, _source in (
    (card_sales.FEATURE_NAMES, "카드매출"),
    (account.FEATURE_NAMES, "계좌"),
    (card_spend.FEATURE_NAMES, "카드 사용내역"),
    (documents.FEATURE_NAMES, "서류"),
    (cb.FEATURE_NAMES, "CB"),
    (interview.FEATURE_NAMES, "인터뷰"),
    (combined.FEATURE_NAMES, "조합"),
):
    for _name in _names:
        SOURCE_OF[_name] = _source


def load_case(case_dir):
    def read_json(name, required=True):
        path = os.path.join(case_dir, name)
        if not os.path.exists(path):
            if required:
                raise FileNotFoundError(path)
            return None
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)

    return {
        "card_sales": pd.read_csv(os.path.join(case_dir, "card_sales.csv")),
        "account_tx": pd.read_csv(os.path.join(case_dir, "account_tx.csv")),
        "account_meta": read_json("account_meta.json"),
        "card_spend": pd.read_csv(os.path.join(case_dir, "card_spend.csv")),
        "docs": read_json("docs.json"),
        "cb": read_json("cb.json"),
        "interview": read_json("interview.json", required=False),
    }


def build(case_dir):
    case = load_case(case_dir)

    features, card_aux = card_sales.compute(case["card_sales"])

    spend = card_spend.compute(case["card_spend"], card_aux["card_sales_total_12m"])
    features.update(spend)

    account_features, account_aux = account.compute(
        case["account_tx"], case["account_meta"], features["fin_sales_avg_3m"]
    )
    features.update(account_features)

    sale_dates = pd.to_datetime(case["card_sales"]["date"])
    reference_date = sale_dates.max().date() if len(sale_dates) else MISSING
    features.update(documents.compute(
        case["docs"],
        features["fin_sales_avg_3m"],
        card_aux["card_sales_total_12m"],
        features["fin_recurring_outflow_avg_3m"],
        reference_date,
    ))
    features.update(cb.compute(case["cb"], features["fin_sales_avg_3m"]))
    features.update(interview.compute(case["interview"]))

    combined_features, combined_aux = combined.compute(
        features,
        case["card_sales"],
        card_aux,
        account_aux,
        case["docs"],
        interview.raw_material(case["interview"], "stated_monthly_sales"),
    )
    features.update(combined_features)

    ordered = {name: features[name] for name in FEATURE_ORDER}
    # 업종 벤치마크는 피처 94개에 넣지 않는다. 화면에 붙일 대조 재료로만 쓴다
    benchmark = external.load(features["biz_industry_code"])
    aux = {
        "external": benchmark,
        "external_context": external.context(features, benchmark),
        "card_sales": card_aux,
        "account": account_aux,
        "combined": combined_aux,
        "reference_date": reference_date,
        "cb": case["cb"],
        "has_interview": case["interview"] is not None,
    }
    return ordered, aux


def case_path(case_id):
    return os.path.join(MOCK_DIR, case_id)


def print_features(case_id):
    features, aux = build(case_path(case_id))
    values = sum(1 for v in features.values() if not is_state(v))
    states = len(features) - values
    print("{}  피처 {}개  값 {}개  상태 {}개  하락 원인 {}".format(
        case_id, len(features), values, states, aux["combined"]["sales_drop_driver"]))
    for name in FEATURE_ORDER:
        print("  {:<10} {:<44} {}".format(SOURCE_OF[name], name, _render(features[name])))
    print()


def _render(value):
    if isinstance(value, float):
        return "{:,.6g}".format(value)
    return value


def main():
    case_ids = sys.argv[1:] or sorted(os.listdir(MOCK_DIR))
    for case_id in case_ids:
        print_features(case_id)


if __name__ == "__main__":
    main()
