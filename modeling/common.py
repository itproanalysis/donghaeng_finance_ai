"""결측 상태 값과 계산 공통 도구."""

import numpy as np
import pandas as pd

MISSING = "MISSING"
REFUSED = "REFUSED"
NOT_APPLICABLE = "NOT_APPLICABLE"
UNDECIDED = "UNDECIDED"

STATES = (MISSING, REFUSED, NOT_APPLICABLE, UNDECIDED)


def is_state(value):
    """값이 아니라 결측 상태인지."""
    return isinstance(value, str) and value in STATES


def is_number(value):
    """숫자로 쓸 수 있는 값인지. 상태 문자열과 None, NaN은 제외."""
    if is_state(value) or value is None or isinstance(value, bool):
        return False
    if not isinstance(value, (int, float, np.integer, np.floating)):
        return False
    return not (isinstance(value, float) and np.isnan(value))


def growth(recent, prior):
    """증가율 공통식. 최근 / 이전 - 1. 분모가 0이거나 재료가 없으면 MISSING."""
    if not is_number(recent) or not is_number(prior):
        return MISSING
    if prior == 0:
        return MISSING
    return float(recent) / float(prior) - 1.0


def ratio(numerator, denominator):
    """나눗셈. 분모가 0이거나 재료가 없으면 MISSING."""
    if not is_number(numerator) or not is_number(denominator):
        return MISSING
    if denominator == 0:
        return MISSING
    return float(numerator) / float(denominator)


def slope(values):
    """월별 값의 1차 회귀 기울기. 단위는 값/월. 두 점 미만이면 MISSING."""
    clean = [float(v) for v in values if is_number(v)]
    if len(clean) < 2:
        return MISSING
    x = np.arange(len(clean), dtype=float)
    y = np.asarray(clean, dtype=float)
    return float(np.polyfit(x, y, 1)[0])


def signal_up(value, low, high):
    """값이 클수록 좋은 재료의 방향 신호.

    low와 high가 같으면 부호만 본다. 기울기처럼 경계를 정할 단위가 없는 재료용.
    """
    if not is_number(value):
        return MISSING
    if low == high:
        return 1 if value > high else (-1 if value < low else 0)
    if value >= high:
        return 1
    if value <= low:
        return -1
    return 0


def signal_down(value, low, high):
    """값이 작을수록 좋은 재료의 방향 신호. low 이하면 +1, high 이상이면 -1."""
    if not is_number(value):
        return MISSING
    if value <= low:
        return 1
    if value >= high:
        return -1
    return 0


def compose(signals):
    """imp_ 합성. 방향 신호를 가중치 없이 더하고 쓴 재료 수를 같이 남긴다.

    재료가 하나도 안 남으면 MISSING.
    """
    used = [s for s in signals if is_number(s)]
    if not used:
        return MISSING
    return {"value": int(sum(used)), "materials_used": len(used)}


def month_period(series):
    """날짜 시리즈를 월 Period로."""
    return pd.to_datetime(series).dt.to_period("M")


def window_means(monthly, column, recent, prior):
    """월별 프레임에서 최근 구간과 이전 구간의 평균을 낸다.

    구간을 채울 달이 모자라면 그쪽은 MISSING.
    """
    values = monthly[column].to_numpy(dtype=float)
    n = len(values)
    recent_mean = float(values[n - recent:].mean()) if n >= recent else MISSING
    if n >= recent + prior:
        prior_mean = float(values[n - recent - prior:n - recent].mean())
    else:
        prior_mean = MISSING
    return recent_mean, prior_mean


def window_sums(monthly, column, recent, prior):
    """월별 프레임에서 최근 구간과 이전 구간의 합을 낸다."""
    values = monthly[column].to_numpy(dtype=float)
    n = len(values)
    recent_sum = float(values[n - recent:].sum()) if n >= recent else MISSING
    if n >= recent + prior:
        prior_sum = float(values[n - recent - prior:n - recent].sum())
    else:
        prior_sum = MISSING
    return recent_sum, prior_sum
