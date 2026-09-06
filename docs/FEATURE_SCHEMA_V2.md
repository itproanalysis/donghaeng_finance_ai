# feature_schema_v2

## 목적

기존 인터뷰 평가 기능을 보존하면서, 사업자의 개선 가능성을 설명할 수 있는 feature artifact를 추가합니다. 이 artifact는 현재 대출 승인/거절, 신용등급 또는 자동 상품 추천에 사용되지 않습니다.

## 구조

`src/domain/improvement-feature-pipeline.ts`가 dictionary와 계산의 단일 원천입니다.

| 그룹 | prefix | 개수 | 원천 |
|---|---:|---:|---|
| 사업 현황 | `biz_` | 12 | 사업 프로필·향후 매출 이력 |
| 재무/거래 | `fin_` | 23 | 거래/재무 데이터·인터뷰 매출/고정비 |
| 채무/신용 | `crd_` | 15 | 승인된 신용 원천이 있을 때만 |
| 운영 효율 | `ops_` | 10 | 운영 데이터·반복고객 직접 진술 |
| 사장님 인터뷰 | `own_` | 20 | canonical interview plan/readiness |
| 외부 환경 | `ext_` | 12 | optional peer/context interface |
| 개선 가능성 | `imp_` | 8 | 위 원천의 null-safe 파생 |

모든 feature는 `name`, `group`, `dtype`, `source`, `window`, `missingPolicy`, `direction`, `version`, `modelCandidate` 메타데이터를 갖습니다. 누락은 0으로 바꾸지 않으며, 유효한 0은 그대로 보존합니다.

## 인터뷰 연결

`buildInterviewFeatureV2(records)`는 canonical information revision의 직접 진술만 사용합니다.

- `monthly_average_sales` → `fin_sales_avg_3m`
- `fixed_operating_costs` + 매출 → `fin_fixed_cost_ratio`
- `repeat_customer_share` → `ops_repeat_customer_ratio`
- `improvement_plan` / `execution_readiness` → `own_goal_*`, `own_plan_*`

숫자 범위는 중간값을 만들지 않습니다. exact 값만 numeric feature로 변환하며, 그 외에는 `MISSING`입니다.

## 6개 핵심 개선가능성 피처

| 피처 | 의미 | 금지된 해석 |
|---|---|---|
| `imp_recovery_momentum` | 매출·잔액·현금흐름·연체 회복의 최근 방향 | 신용점수 |
| `imp_cashflow_stabilization` | 잔액·현금흐름·적자월·상환부담 관측 신호 | 상환 가능성 보증 |
| `imp_cost_adjustment_headroom` | peer gap, 이자비용, 사장님 비용 계획이 있을 때의 조정 영역 | 비용이 높다는 단정 |
| `imp_sales_recovery_potential` | 저점 회복·반복수요·매출/peer 변화 신호 | 매출 예측 |
| `imp_plan_specificity` | 목표·기간·예산·지표·시작일·제약의 직접 명시성 | 성실성/의지 점수 |
| `imp_plan_feasibility` | 현실성 검토에 필요한 직접 입력의 충족도 | 성공 확률 |

`imp_overall_improvement_signal`도 설명 UI용이며 모델·승인 판단에 사용할 수 없습니다.

## 통합 및 feature flag

- LIVE snapshot과 FINAL snapshot API의 `improvementFeatures`에 v2 artifact를 포함합니다.
- `GET /api/interviews/{id}/live-features`도 `improvementFeatures`를 반환합니다.
- `ENABLE_FEATURE_V2=false`로 feature 전체가 `MISSING/null`인 비활성 artifact를 반환합니다.
- 기존 `features`, evaluation, API 응답은 삭제·rename하지 않았습니다.
- 외부 context는 `FeatureV2Input.external` optional interface로만 받습니다. 외부 API와 크롤러는 추가하지 않았습니다.

## 검증

- dictionary duplicate/name/version 검증
- 동일 train/inference builder parity
- null, 0, NaN, disabled flag 검증
- canonical interview 변환 및 missingness report
- live/final service API 통합 회귀


## 심사 화면과 FINAL 보존 (2026-09-06)

`GET /api/interviews/{id}/data-review`는 `InterviewService`의 `improvementFeatures`를 읽는 서버 투영입니다. 값은 재계산하지 않고 사전의 설명·window·missingPolicy, 파생 `sourceFeatures`, 선택된 Canonical revision, Evidence와 원문을 연결합니다. `/judge-demo`, 기존 사업자 LIVE/FINAL 화면, `/review/{id}`가 이 API를 공유합니다. 7개 그룹·100개 사전을 그대로 사용하고 `modelCandidate:false`를 유지합니다.

새 FINAL에는 종료 시점의 `improvementFeatures`를 payload와 hash에 포함합니다. `FROZEN_FINAL` 표시는 이후 환경 flag를 바꿔도 저장 artifact가 바뀌지 않는다는 뜻입니다. 이전 FINAL에 artifact가 없으면 저장된 Canonical로 투영한 `LEGACY_PROJECTION`임을 명시합니다. 이전 FINAL을 덮어쓰지 않습니다.

현재 6개 Signal은 신용 점수·개선 성공 확률이 아닙니다. 사용 가능한 입력에 대한 기존 산식의 값이며 일부 입력만 있어도 계산됩니다. UI는 원시값·사용한 입력·누락 입력을 함께 표시합니다. 특히 `imp_plan_specificity`, `imp_plan_feasibility`의 1은 계획의 완전성이나 성공을 뜻하지 않습니다. 평균의 분모는 확보된 입력에 한정됩니다.

Recovery의 새 Evidence는 별도 append-only 저장소이며 FINAL 원본·v2 Feature·데이터 품질 평가를 변경하지 않습니다. 파일 업로드와 증빙 진위 확인, 자동 재평가를 제공하지 않습니다.
