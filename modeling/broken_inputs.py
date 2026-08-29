"""깨진 입력 테스트.

정상 케이스 하나를 복사해 입력을 망가뜨리고, 계산이 조용히 틀린 값을 내지 않는지 본다.
통과 기준은 둘 중 하나다. 죽지 않고 계산 못 한 자리를 결측 상태로 남기거나,
계산을 진행할 수 없다는 것을 예외로 알리거나.

결과는 validate.py가 받아 같은 출력에 찍는다.
"""

import os
import shutil
import tempfile

import pandas as pd

from .build import build, case_path
from .common import is_number, is_state

SOURCE_CASE = "case_customer_drop"

# 3개월 이력만 남겼을 때 창을 채울 수 없어 MISSING이 되어야 하는 피처
SHORT_HISTORY_MISSING = (
    "fin_sales_growth_3m",
    "biz_sales_cv_6m",
    "ops_count_growth_3m",
    "ops_ticket_growth_3m",
    "biz_operating_day_change_3m",
)


def _empty_file(case_dir):
    """헤더만 남기고 카드매출을 전부 지운다."""
    path = os.path.join(case_dir, "card_sales.csv")
    pd.read_csv(path).head(0).to_csv(path, index=False)


def _drop_column(case_dir):
    """카드매출에서 배달 매출 열을 통째로 뺀다."""
    path = os.path.join(case_dir, "card_sales.csv")
    pd.read_csv(path).drop(columns=["delivery_amount"]).to_csv(path, index=False)


def _short_history(case_dir):
    """12개월 이력을 마지막 3개월만 남긴다."""
    path = os.path.join(case_dir, "card_sales.csv")
    frame = pd.read_csv(path)
    month = frame["date"].str[:7]
    frame[month.isin(sorted(month.unique())[-3:])].to_csv(path, index=False)


def _empty_account(case_dir):
    """헤더만 남기고 계좌 거래를 전부 지운다."""
    path = os.path.join(case_dir, "account_tx.csv")
    pd.read_csv(path).head(0).to_csv(path, index=False)


def _shuffle_dates(case_dir):
    """날짜 순서를 뒤섞는다. 값은 그대로다."""
    path = os.path.join(case_dir, "card_sales.csv")
    pd.read_csv(path).sample(frac=1.0, random_state=SHUFFLE_SEED).to_csv(path, index=False)


SHUFFLE_SEED = 7

BROKEN = (
    ("빈 카드매출 파일", _empty_file),
    ("빈 계좌 파일", _empty_account),
    ("배달 매출 열 누락", _drop_column),
    ("3개월 이력만", _short_history),
    ("날짜 뒤섞임", _shuffle_dates),
)


def _blank_values(features):
    """상태 문자열이 아니면서 값도 아닌 자리. None과 NaN."""
    return [name for name, value in features.items()
            if value is None or (isinstance(value, float) and value != value)]


def run():
    """망가진 입력을 돌려 (이름, 통과 여부, 설명) 목록과 완주한 산출물을 낸다.

    완주한 산출물은 규칙 커버리지를 셀 때 같이 쓴다. 결측 경로는 정상 케이스로는
    밟히지 않고 재료가 빠졌을 때만 밟히기 때문이다.
    """
    baseline, _ = build(case_path(SOURCE_CASE))
    results = []
    built = {}
    root = tempfile.mkdtemp(prefix="broken_inputs_")
    try:
        for name, mutate in BROKEN:
            case_dir = os.path.join(root, name)
            shutil.copytree(case_path(SOURCE_CASE), case_dir)
            mutate(case_dir)
            results.append(_check(name, case_dir, baseline))
            try:
                built[name] = build(case_dir)
            except Exception:
                pass
    finally:
        shutil.rmtree(root, ignore_errors=True)
    return results, built


def _check(name, case_dir, baseline):
    try:
        features, _ = build(case_dir)
    except Exception as error:
        return (name, True, "{} 로 계산을 멈춤".format(type(error).__name__))

    blanks = _blank_values(features)
    if blanks:
        return (name, False, "값도 상태도 아닌 자리 {}".format(blanks[:4]))

    if name == "3개월 이력만":
        filled = [f for f in SHORT_HISTORY_MISSING if not is_state(features[f])]
        if filled:
            return (name, False, "창이 모자란데 값이 나옴 {}".format(filled))
        states = sum(1 for v in features.values() if is_state(v))
        return (name, True, "완주, 상태 {}개".format(states))

    if name == "날짜 뒤섞임":
        differing = [n for n in baseline if not _same(features[n], baseline[n])]
        if differing:
            return (name, False, "정렬 전후가 다름 {}".format(differing[:4]))
        return (name, True, "원본과 94개 전부 일치")

    states = sum(1 for v in features.values() if is_state(v))
    return (name, True, "완주, 상태 {}개".format(states))


def _same(left, right):
    if is_number(left) and is_number(right):
        return abs(float(left) - float(right)) <= 1e-9 * max(1.0, abs(float(right)))
    return left == right


def main():
    results, _ = run()
    for name, passed, note in results:
        print("  [{}] {:<20} {}".format("PASS" if passed else "FAIL", name, note))


if __name__ == "__main__":
    main()
