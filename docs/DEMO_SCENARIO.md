# 시연 시나리오

심사위원이 처음부터 끝까지 볼 수 있는 사장님 인터뷰 한 건이다. 인터뷰 답변이
2축 점수를 바꾸는 경로를 화면에서 확인하는 것이 목적이다.

대본은 `src/domain/demo-scenario.ts`에 있고, 문서와 자동 재생과 검증 스크립트가
전부 이 파일 하나를 읽는다. 문서에만 있고 실물이 없는 대본이 생기지 않게 하기
위해서다.

## 무엇을 보여 주는가

거래 데이터가 완전히 같은 두 인터뷰를 나란히 놓는다. 다른 것은 사장님이 영업일
감소 사유와 개선 목표를 답했는지 하나뿐이다.

| | 사유와 목표를 답한 인터뷰 | 답하지 않은 인터뷰 |
|---|---:|---:|
| 현재 상황 | 78.0 | 78.0 |
| 개선가능성 | 67.5 | 30.0 |

현재 상황 축은 거래 데이터만 쓰므로 두 인터뷰가 같다. 개선가능성에서 매출 방향이
10점에서 0점으로, 계획의 현실성이 20점에서 0점으로 내려간다. 인터뷰가 무엇을
바꾸는지가 이 두 항목에 그대로 나온다.

6개월 뒤 거래 데이터로 같은 계산 함수를 다시 돌리면 목표 영업일 29일에 대해
23.7일에서 30.7일로 올라 달성으로 나온다. 목표를 세우는 것에서 끝나지 않고 같은
기준으로 다시 재는 데까지 이어진다.

## 사장님

`data/mock/case_operating_drop`의 값을 그대로 쓴다. 새로 지어낸 숫자는 없다.

| 항목 | 값 |
|---|---|
| 이름·사업체 | 표기웅, 느티나무감자탕 (가상 인물) |
| 업종 | RESTAURANT |
| 카드 매출 3개월 평균 | 2,400만원 |
| 진술 월매출 | 2,600만원 |
| 3개월 매출 증가율 | -20% |
| 하락 원인 | 영업일 감소 (거래 데이터에서 계산) |
| 3개월 평균 영업일 | 23.7일 |
| 반복 출금 3개월 평균 | 1,194만원 |
| 순현금흐름 3개월 평균 | 115만원 |
| 하락 사유 | 건강, 지금은 해소됨 |
| 목표 | 3개월 평균 영업일 29일, 6개월 안에 |
| 계획 예산 | 80만원 |

이 케이스를 고른 이유는 셋이다.

- 인터뷰 답이 점수를 바꾸는 경로가 이 케이스에만 실물로 있다.
  `modeling/thresholds.py`의 `DRIVER_GOAL_FEATURE`가 인정하는 목표 피처가 셋인데
  영업일이 그중 하나다.
- 거래 데이터가 같고 인터뷰 답만 다른 대조 케이스(`case_no_answer`)가 이미 있다.
- 6개월 뒤 거래 데이터(`case_operating_drop_after`)와 재평가 코드가 있다.

## 화면 순서

1. 홈의 **답변 → 변수 → 점수 시연** 또는 `/borrower?scenario=operating-day`로 들어간다. 가상 인물·합성 거래자료 사용을 확인하고 AI 처리에 동의한 뒤 채팅을 시작한다.
2. **대본 자동 입력**을 눌러 시작하거나 직접 답한다. URL만으로 답변을 제출하지 않는다. 12개 필드 중 기본 8개와 조건부 질문 1개에 답하는 9턴 시연이며, 추가 참고 3개는 미확인으로 남는다. 중간에 멈출 수 있다.
3. **영업일 사유 질문이 이 인터뷰에서만 나온다.** 거래 데이터에서 문 연 날이
   20.2% 줄어든 것이 확인돼 `modeling/triggers.py`가 이 질문을 목록에 넣었기
   때문이다. 다른 케이스에서는 나오지 않는다.
4. 개선 계획 답변에서 목표 영업일 29일, 기간 6개월, 확인 방법(장부)이 잡힌다.
5. 인터뷰를 마치면 FINAL 기록이 만들어진다.
6. 완료 화면에서 현재 상황·개선가능성과 항목별 배점·분모를 바로 확인한다. 담당자 검토 링크로 원문·구조화 결과·데이터 품질도 확인한다. 공식 CB가 연결되지 않았으면 미연결로 남긴다.
7. `/borrower?scenario=operating-day&demoSet=control`로 한 번 더 돌리면 개선가능성만 30점으로 내려간
   결과를 비교할 수 있다.

## 대본

답변 문장은 서버의 결정론적 parser를 실제로 통과해야 한다. 통과 여부는
`tests/domain/demo-scenario.test.ts`가 판정하며, 문장을 흐리게 바꾸면 테스트가
깨진다.

| 항목 | 답변 |
|---|---|
| 월평균 매출 | 최근 3개월 월평균 매출은 2600만원입니다. |
| 월 고정 운영비 | 고정비는 월 1190만원입니다. |
| 영업일 감소 사유 | 지난봄에 허리를 다쳐서 자주 문을 닫았습니다. 지금은 치료가 끝나서 다시 매일 열고 있습니다. |
| 사업 개선 계획 | 가장 큰 문제는 일손이 부족해서 가게 문을 못 여는 날이 생기는 것입니다. 여는 날을 지금 23일에서 6개월 안에 29일까지 늘리고, 장부로 매번 확인하겠습니다. |
| 실행 준비도 | 예산 80만원은 확보했고 일정도 정했습니다. 아직 일손이 부족합니다. |
| 확정 예약 건수 | 앞으로 4주 안에 확정된 예약이나 주문은 0건입니다. |
| 계절성 전망 | 앞으로 3개월은 비수기라 작년 이맘때도 주문이 줄었고 올해도 줄 것 같습니다. |
| 월 필수 가계지출 | 필수 가계지출은 월 220만원입니다. |
| 비상자금 보유기간 | 비상자금으로 필수 생활비를 3개월 감당할 수 있습니다. |
| 플랫폼 비용부담 | 배달은 거의 안 해서 플랫폼 수수료 부담 없습니다. |
| 홀매출 감소 | 홀 손님은 문을 못 연 날 말고는 그대로입니다. |
| 반복고객 비중 | 최근 한 달 기준 단골 매출은 45%입니다. |

대조 인터뷰는 세 답변만 다르다.

| 항목 | 답변 |
|---|---|
| 영업일 감소 사유 | 그건 잘 모르겠습니다. |
| 사업 개선 계획 | 아직 계획을 정하지 못했습니다. |
| 실행 준비도 | 아직 준비하지 못했습니다. |

가계지출 금액은 대본에만 있는 값이다. 진술 단독 항목이라 2축 점수에 들어가지
않으며, 답을 거부하면 앱이 인터뷰 완료를 막기 때문에 금액으로 답한다.

## 프론트엔드 붙이는 법

자동 입력은 등록된 합성 프로필, `?demo=operating-day`, 채팅 모드, 사용자의 자동 입력 버튼 선택이 모두 충족될 때만 동작한다. 자동 입력은 기본적으로 꺼져 있으며 일시정지할 수 있다.

```
/borrower/interviews/{id}?demo=operating-day
/borrower/interviews/{id}?demo=operating-day&demoSet=control
```

붙인 지점은 `src/components/borrower-interview-room.tsx`의 훅 호출 한 곳이다.

```tsx
useDemoAutoplay({
  enabled: isScenario && demoAvailable && method === "chat" && demoRunning,
  currentQuestionInfoCode: live?.currentQuestionInfoCode ?? null,
  ready: !responseDisabled,
  submitAnswer: (text) => void submitAnswer(text),
});
```

다른 화면에서도 합성 시연 여부와 명시적 시작 상태를 확인해야 한다. 답변 사이 간격은 기본 1.2초이고
`delayMs`로 바꾼다. 사람이 직접 클릭하는 시연은 쿼리 없이 그냥 진행하면 된다.

대본을 코드에서 직접 읽으려면 이렇게 한다.

```ts
import { OPERATING_DAY_DEMO_SCENARIO } from "@/domain/demo-scenario";

OPERATING_DAY_DEMO_SCENARIO.persona;              // 이름, 사업체명, 업종
OPERATING_DAY_DEMO_SCENARIO.triggeredInfoCodes;   // 추가로 넣을 질문 코드
OPERATING_DAY_DEMO_SCENARIO.primary.answers;      // infoCode별 답변
OPERATING_DAY_DEMO_SCENARIO.control.answers;      // 대조 인터뷰 답변
```

인터뷰를 만들 때 조건부 질문을 목록에 넣으려면
`createDevV1ScenarioRequiredInformationItems(triggeredInfoCodes)`를 쓴다. 기존
8항목·11항목 팩토리는 바뀌지 않았다.

같은 답변이 후속질문을 부르면 자동 재생은 그 자리에서 멈춘다. 같은 문장을 다시
보내도 풀리지 않기 때문이다. 이때는 발표자가 직접 입력해 이어가면 된다.

## 인터뷰 결과를 점수로 옮기는 규칙

`src/domain/modeling-interview-mapping.ts`가 인터뷰 결과를 modeling이 읽는
`interview.json` 필드로 옮긴다. 계산은 하지 않고 이름과 단위만 바꾼다. 옮길 수
없는 값은 0이나 중간값을 만들지 않고 상태 문자열로 남긴다.

| 앱 infoCode | modeling 필드 | 옮기는 방법 |
|---|---|---|
| `monthly_average_sales` | `stated_monthly_sales` | 정확한 금액만 |
| `essential_household_expenses` | `own_essential_expense` | 거부하면 REFUSED |
| `emergency_buffer_months` | `own_buffer_months` | 개월 수 |
| `repeat_customer_share` | `ops_repeat_customer_ratio` | 퍼센트를 100으로 나눔 |
| `seasonality_outlook` | `own_seasonality_direction` | UP은 성수기, DOWN은 비수기 |
| `hall_customer_decline` | `biz_hall_customer_decline_flag` | 관측 여부 |
| `improvement_plan` | `own_goal_evidence_feature`, `own_goal_target_value`, `own_goal_horizon_days` | 목표 단위로 대조 피처를 정함 |
| `execution_readiness` | `own_plan_budget` | 예산 금액이 있을 때만 |
| `operating_day_drop_reason` | `own_operating_day_drop_reason`, `own_operating_day_drop_resolved_flag` | 사유 보기와 해소 여부 |

목표 단위와 대조 피처의 대응은 아래와 같다. `modeling/thresholds.py`의
`DRIVER_GOAL_FEATURE`가 인정하는 셋만 대상이다.

| 목표 단위 | 대조 피처 |
|---|---|
| 일 | `biz_operating_day_count_avg_3m` |
| 건 | `ops_transaction_count_avg_3m` |
| 원 | `ops_avg_ticket_3m` |

옮기지 않는 필드와 그 이유는 `MODELING_UNMAPPED_FIELDS`에 코드로 적혀 있고
`tests/domain/modeling-interview-mapping.test.ts`가 값이 생기지 않았는지 본다.

- `own_peak_months`: 앱이 성수기 달을 묻지 않는다
- `own_primary_problem`, `own_plan_action_category`, `own_plan_blockers`,
  `own_plan_top_blocker`: 앱은 자유서술로 받아 보기로 바꾸지 않는다
- `own_prior_action_*`, `own_fund_*`: 앱이 묻지 않는다
- `ops_platform_fee_ratio`: 앱은 부담 여부만 받고 modeling은 비율을 요구해 단위가
  다르다
- 잡혀 있는 계약 3필드: 음식점에는 해당하지 않아 NOT_APPLICABLE로 둔다

## 점수 계산 연결

관리자 화면의 2축 카드는 `GET /api/interview-evaluations/{id}/scorecard`를 읽는다.
서버가 권한을 확인한 FINAL 답변을 위 규칙으로 옮겨 OS 임시 폴더에서 `python -m modeling.scorecard --case-dir`를 실행한다. 임시 답변 파일은 성공·실패 모두 정리한다. 같은 완료 결과의 재요청은 캐시하고 동시 계산은 2건으로 제한한다. 같은 규칙을 TypeScript로 다시
구현하지 않았다. 두 곳에 두면 어긋나기 때문이다.

등록된 합성 시연 프로필에만 고정 합성 거래자료를 결합한다. 일반 입력은 `SCENARIO_NOT_LINKED`로 점수를 만들지 않는다. FINAL에 저장된 한글 업종명은 공식 카탈로그 코드로 변환한다. 화면에 거래자료의 출처를 표시한다.

실행에 필요한 환경 변수는 둘이다.

| 변수 | 값 | 뜻 |
|---|---|---|
| `DONGHAENG_MODELING_PYTHON` | `.venv/bin/python` | modeling 인터프리터 경로 |
| `DONGHAENG_MODELING_BASE_CASE` | `data/mock/case_operating_drop` | 거래 데이터를 가져올 케이스 |

둘 중 하나라도 없으면 점수를 추정해 채우지 않고 화면에 미연결로 표시한다. 로컬
음성이 준비되지 않았을 때 가짜 전사를 만들지 않는 것과 같은 원칙이다.

## 한계

- 거래 데이터, CB 조회, 서류가 전부 데모용 mock이다. 실제 고객 데이터는 0건이다.
- 6개월 뒤 데이터도 mock이다. 사장님이 실제로 목표를 이룬 기록이 아니라, 재평가가
  같은 계산 함수로 도는지 확인하는 입력이다.
- 인터뷰가 사장님의 거래자료를 직접 받지 않는다. 등록된 합성 시연에만 지정된 기준 자료를 연결한다.
- `modeling/thresholds.py`의 경계값은 임시값이다. 실데이터가 쌓이면 조정한다.
- 2축 점수는 승인, 거절 판단이 아니고 신용등급도 아니다. CB 점수 옆에 나란히
  놓는 참고자료다.
- 스코어카드 구간 52개 중 13개는 아직 밟는 케이스가 없다. 목록은
  `modeling/validate.py`의 `BANDS_WITHOUT_CASE`에 있다.

## 재현

```bash
python3 -m venv .venv
.venv/bin/pip install -r modeling/requirements.txt
.venv/bin/python -m modeling.make_mock
.venv/bin/python -m modeling.validate

npm install
npm test
npm run typecheck
npm run lint
npm run build
npm run verify:demo
```

`npm run verify:demo`가 서버를 띄우고 대본대로 인터뷰를 끝까지 진행한 뒤, 그
결과로 계산한 점수를 mock 케이스의 점수와 대조한다. 이 스크립트는 판정만 하고
코드나 대본을 고치지 않는다.

실제 공개 AI 공급자와 배포된 Python을 함께 확인하려면 `npm run verify:demo -- --public-live https://donghaeng-finance-review-jy5k5cvnjq-du.a.run.app`을 실행한다. 등록된 합성 primary/control 기록만 생성하며 보호된 운영자 서비스는 검사하지 않는다. 웹 진입과 검증 스크립트는 `createBorrowerRequiredInformationList`를 공유해 조건부 질문의 P0 우선순위를 유지한다.

사람이 직접 볼 때는 이렇게 띄운다.

```bash
DONGHAENG_MODELING_PYTHON=.venv/bin/python \
DONGHAENG_MODELING_BASE_CASE=data/mock/case_operating_drop \
npm run dev
```

### 실행 기록

```
대본대로 인터뷰 진행
  [PASS] 영업일 사유 질문이 인터뷰에 나옴  질문 9개
  [PASS] 12항목이 전부 정리됨  12개
  [PASS] FINAL 완료 상태  COMPLETE
  [PASS] 평가가 만들어짐  READY
  [PASS] 영업일 목표가 29일로 확정됨  29 DAY

대조 인터뷰 진행
  [PASS] 대조 인터뷰도 끝까지 진행됨  COMPLETE

2축 점수 대조
  [PASS] 본 인터뷰 점수가 계산됨
  [PASS] 대조 인터뷰 점수가 계산됨
  [PASS] 본 인터뷰가 mock 케이스와 같은 점수  현재 78 / 개선 67.5
  [PASS] 대조 인터뷰가 mock 케이스와 같은 점수  현재 78 / 개선 30
  [PASS] 거래 데이터가 같아 현재 상황 점수는 같음  78 = 78
  [PASS] 사유와 목표를 답한 쪽의 개선가능성이 더 높음  67.5 > 30

재현성
  [PASS] 같은 인터뷰를 두 번 계산해도 결과가 같음

6개월 뒤 재평가
  [PASS] 목표 영업일을 같은 계산 함수로 다시 잰다  23.666666666666668 → 30.666666666666668 (목표 29)
  [PASS] 목표 달성 여부가 나온다  true

검사 15개 중 15개 통과
전체 통과
```

## 공개 실행 환경

GCP 컨테이너는 Python 가상환경과 모델 코드를 포함한다. 합성 거래자료는 영구 DB 볼륨과 겹치지 않는 `/app/modeling-fixtures/case_operating_drop`에 둔다. 운영자용 화면에서도 동일한 API 결과를 사용한다. `verify:demo`는 실행 중인 개발 서버를 건드리지 않고 프로덕션 빌드를 별도 루프백 포트에서 실행한다. 질문 공급자만 로컬 모의 응답을 사용하며 실제 Python 계산과 API·FINAL 저장을 거친다. 실제 공급자 동작은 공개 배포 후 별도로 확인한다.
