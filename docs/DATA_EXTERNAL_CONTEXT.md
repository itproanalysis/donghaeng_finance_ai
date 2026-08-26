# 외부 맥락 데이터 레이어

앱은 외부 API·크롤러를 두지 않으므로, 외부 맥락 데이터는 **파일로 주입**됩니다.
이 문서는 그 주입물이 무엇이고 어떤 계약을 지키는지를 정의합니다.

```
공개/보유 통계 → 업종별 가공 → 12필드 변환 → peer_benchmark.json → FeatureV2Input.external
```

산출물은 `external-data/`에 있습니다.

| 파일 | 내용 | 문서 |
|---|---|---|
| `peer_benchmark.json` | 11업종 × 12필드 주입물 | 이 문서 |
| `coverage_matrix.json` | 132칸 상태 대장 (왜 비어 있는지) | [DATA_INDUSTRY_COVERAGE](DATA_INDUSTRY_COVERAGE.md) |
| `industry_mapping.json` | KSIC(10차) → `SohoIndustryCode` 대응표 | [DATA_INDUSTRY_COVERAGE](DATA_INDUSTRY_COVERAGE.md) |
| `credit_position.json` | CreDB 신용 포지션 분위수 | [DATA_CREDIT_POSITION](DATA_CREDIT_POSITION.md) |
| `verify_peer_benchmark_contract.py` | 계약 대조기 | 이 문서 |
| `credit_position_lookup.py` | 값 → 백분위 역조회 | [DATA_CREDIT_POSITION](DATA_CREDIT_POSITION.md) |

> `data/`가 아니라 `external-data/`를 쓰는 이유는 `.gitignore`의 `/data/**` 때문입니다.
> `data/`는 런타임 SQLite와 모델 가중치 자리라 추적되지 않아, 거기 두면 전달 자체가 되지 않습니다.

## 사용

```ts
import benchmark from "../external-data/peer_benchmark.json";

buildFeatureV2({
  raw,
  external: benchmark.benchmarks[industryCode],  // 래핑·키 변환 없이 그대로
});
```

`benchmarks[code]`는 `ExternalContextFeatureInput`과 필드명·순서가 1:1입니다.
`industryCode`는 `SohoIndustryCode` 11종을 그대로 씁니다.

## 계약 3조

### 1. 단위는 0–1 소수입니다

`src/domain/improvement-feature-pipeline.ts`가 이렇게 계산하기 때문입니다.

| 위치 | 계산 |
|---|---|
| `:584` | `raw.fin_fixed_cost_ratio = costAmount / saleAmount` |
| `:589` | `raw.ops_repeat_customer_ratio = percentage / 100` |

**고정비 비중 31.5%는 `31.5`가 아니라 `0.315`입니다.** 비교 대상인 `fin_*`가 소수이므로
`ext_*`가 퍼센트로 들어오면 `*_gap_peer`가 100배 틀어집니다.

변화율도 같습니다. `:432`가 `boundedPositive(ext_sales_growth_gap_peer, 0.2)`로 정규화하는데,
scale `0.2`는 "20% 격차에서 포화"를 뜻하므로 입력이 소수임을 전제합니다.

### 2. 결측은 `null`이지 `0`이 아닙니다

파이프라인이 결측을 0으로 바꾸지 않고 유효한 0은 보존하도록 설계돼 있습니다.
데이터 레이어도 같은 규칙을 지킵니다. **현재 45칸이 채워져 있고 87칸이 null입니다.**

결측은 숨길 결함이 아닙니다. CB가 보지 못하는 영역이 어디인지가 이 서비스의 논거이므로,
비어 있다는 사실 자체가 산출물의 일부입니다. 칸마다의 사유는 `coverage_matrix.json`에 있습니다.

### 3. `*_gap_peer` 2필드는 데이터 레이어가 채우지 않습니다

`ext_sales_growth_gap_peer`, `ext_cost_ratio_gap_peer`는 **사장님 본인 값이 있어야
계산되는 런타임 파생값**입니다. 벤치마크 시점에는 사장님이 없습니다.

이 파일에서는 항상 `null`로 나가며, 주입 시점에 `ext_peer_*`와 사장님 값으로 계산하는 것이
앱의 몫입니다. 검증기가 이 규칙을 강제하므로 실수로 채우면 검증이 깨집니다.

## 범위 밖

12필드는 전부 `direction: "context_only"`, `modelCandidate: false`입니다.
인터뷰 컨텍스트 카탈로그는 `externalBaselinePolicy: "ONLY_IF_BORROWER_HISTORY_UNAVAILABLE"`입니다.

따라서 이 데이터는 **점수·등급 산출 입력이 아니며**, 사장님 본인 이력이 있으면 쓰이지도 않습니다.
앱의 A~E는 `INTERVIEW_DATA_QUALITY_GRADE_DEV_V1`(인터뷰 정보 충족도)이고 신용등급이 아닙니다.

매출 백분위·등급화·페르소나 분석은 소비처가 다른 별도 트랙이며 이 파일에 섞지 않습니다.

## 현재 채워진 값 — 45/132 (34.1%)

KOSIS 서비스업동향조사 `DT_1KC2020`(산업별 서비스업생산지수)에서 **5필드 × 9업종**을
산출했습니다. 기준월 **2026-06**, 창 60개월.

| 필드 | 상태 |
|---|---|
| `ext_peer_sales_growth_3m` | 9업종 |
| `ext_peer_sales_volatility_6m` | 9업종 · **절대 수준 사용 금지** |
| `ext_industry_growth_6m` | 9업종 |
| `ext_industry_volatility_12m` | 9업종 · **절대 수준 사용 금지** |
| `ext_industry_seasonality` | 9업종 · 0~1 |

빠진 2업종은 `OFFLINE_RETAIL`(`G4791`과 분류 중복, 분리 가중치 미공표)과
`INTERIOR`(서비스업동향조사에 건설 `F` 없음)입니다.

### 세 가지를 먼저 읽어 주세요

**① `source_type`은 9업종 모두 `derived_from_KOSIS`입니다.** 지수 원계열은 KOSIS가 준
것이지만 **계절조정은 데이터 레이어가 했습니다.** 원계열로 성장률을 계산하면 계절 효과가
부호를 뒤집기 때문입니다(`LODGING` 3개월: 원계열 +0.105 vs 계절조정 −0.052).

**② `validated_against_kosis`가 검증 여부입니다.** KOSIS 계절조정지수(`T3`)가 제공되는
4업종(`RESTAURANT` `LODGING` `TRANSPORT` `WHOLESALE_SMALL_MANUFACTURING`)에서 산식을
대조했고 계절요인 상관 0.949~0.985로 일치했습니다. 나머지 5업종은 `T3`가 없어 대조하지
못했습니다 — **검증은 산식의 타당성 확인이지 그 5업종 값의 보증이 아닙니다.**

**③ 변동성 2필드는 절대 수준을 쓰면 안 됩니다.** 자체 계절조정이 KOSIS X-13보다 월간
잡음을 남겨 변동성이 약 2배 높게 나옵니다. **9업종 사이의 상대 비교로만** 읽어 주세요.
성장률과 계절성에는 이 문제가 없습니다(성장률 오차 0.1~1.6%p).

산식·창 선택 근거·정규화 상한은 [DATA_INDUSTRY_COVERAGE](DATA_INDUSTRY_COVERAGE.md)에,
기계가 읽을 형태는 artifact의 `method` · `validation` 블록에 있습니다.

### 아직 비어 있는 87칸

`ext_peer_marketing_cost_ratio` · `ext_peer_fixed_cost_ratio` ·
`ext_peer_repeat_customer_ratio` · `ext_foot_traffic_change_3m`(각 11칸),
`ext_competitor_count_change_6m`(9칸 `blocked` + 2칸 `not_applicable`),
`*_gap_peer` 2필드(22칸 영구 null), KOSIS 5필드의 2업종(10칸).

한동안 `RESTAURANT` · `CAFE`의 `ext_peer_fixed_cost_ratio`에 KREI 외식업체경영실태조사에서
뽑은 0.308 · 0.315가 들어 있었으나, **이번 전달에서 KREI를 제외했습니다.**

- `RESTAURANT`에 연결한 `ALL_FOODSERVICE` 코호트에 카페·제과점이 포함돼 `CAFE`와
  배타적이지 않았습니다. KSIC 매핑(`CAFE` = I5622 + I56191, `RESTAURANT` = I561·I562 − 그 둘)에
  맞춰 코호트를 다시 자르지 않는 한 두 값이 같은 응답자를 공유합니다.
- KREI는 외식업 전용 조사라 **11업종 중 2개만 닿습니다.** 축 전체를 채우지 못합니다.

제외 기록은 지우지 않고 artifact의 `lineage.excluded_sources`에 남겼습니다.
어떤 값이 들어갈 뻔했는지, 왜 뺐는지, 어떻게 되살리는지가 그 블록에 있습니다.

원자료와 분위수 산출물은 데이터 저장소에 그대로 있습니다. **앱 전달물에서만 뺀 것이고
다른 트랙에서는 계속 씁니다.**

칸마다의 상태와 사유는 `coverage_matrix.json`과
[DATA_INDUSTRY_COVERAGE](DATA_INDUSTRY_COVERAGE.md)에 있습니다.

## 검증

```bash
python3 external-data/verify_peer_benchmark_contract.py
```

문서가 아니라 **`src/domain`의 TypeScript 소스를 직접 파싱**해서
`ExternalContextFeatureInput`과 `SohoIndustryCode`를 읽어 대조합니다.
계약을 바꾸면 여기서 먼저 깨지므로, 인터페이스 변경 시 이 스크립트를 함께 확인해 주세요.

검사 항목은 7가지입니다.

- 값이 float 또는 null인가
- 결측을 0으로 채우지 않았는가
- **모든 값이 0–1 소수 범위인가** (비중은 `[0, 1]`, 변화율은 `|v| <= 1`)
- 런타임 파생 필드가 null인가
- 12필드 이름·순서가 인터페이스와 같은가
- 업종 코드·순서가 enum과 같은가
- 12필드 전부 lineage 기록이 있는가

세 번째가 계약 1조를 강제합니다. `0.315` 대신 `31.5`를 넣으면 `fin_*` 소수와 100배
어긋난 채로 조용히 통과하므로, 이 검사가 없으면 눈으로는 발견하기 어렵습니다.

CI에 넣으려면 vitest로 옮겨도 됩니다. 파싱 로직이 정규식 두 개뿐이라 이식이 쉽습니다.

## 원자료를 여기 두지 않는 이유

`external-data/`에는 **정형 산출물만** 둡니다. 원자료(신용정보원 CreDB 모의DB·SDB 표본,
KREI 원시자료, 상가정보 352MB)는 데이터 저장소에 있고 `.gitignore`가 유입을 막습니다.

- 신용정보원 표본은 금융데이터거래소 **계정 인증 후 받는 자료**라 재배포 조건이 열려 있지 않습니다
- git은 대용량 파일 이력을 영구 보관하므로 한 번 커밋하면 나중에 지워도 이력에 남습니다
- 앱은 원자료를 읽지 않습니다. 읽는 것은 이 폴더의 JSON뿐입니다

원자료 취득 경로는 각 artifact의 `source` 블록에 기록돼 있습니다.

## 재생성

이 파일들은 손으로 고치지 않습니다. 원자료와 빌더는 데이터 저장소에 있습니다.

```bash
# ~/Desktop/daker_finance_hackathon
python3 scripts/build_peer_benchmark.py      # 로컬 processed/ + 이 폴더로 배달
python3 scripts/build_industry_mapping.py    # KSIC → 11업종 대응표
python3 scripts/build_coverage_matrix.py     # 132칸 상태 대장
python3 scripts/build_credit_position.py     # CreDB → 신용 포지션 분위수
```

빌더는 중간산출물에서 값을 계산하며 하드코딩하지 않습니다.

문의: 데이터 리서치 담당 (sohyun lee)
