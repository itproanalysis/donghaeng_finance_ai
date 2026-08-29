# modeling

`docs/FEATURE_LIST.md`의 피처 94개를 계산하고, 조건부 질문과
`docs/SCORECARD.md`의 2축 점수를 내는 파이썬 코드.

학습 모델 없음. 예측 없음. 규칙이 고정된 계산이라 같은 입력이면 언제나 같은 출력.

## 제품에서의 위치

이 저장소의 제품은 인터뷰 앱(src/, TypeScript)이고, modeling은 그 앱에 들어갈
피처와 점수 규칙의 기준 구현이다. 규칙을 파이썬으로 먼저 만들어 검증하고 제품
코드(src/domain)가 같은 규칙을 구현한다. 피처의 이름과 정의는
docs/FEATURE_LIST.md와 docs/SCORECARD.md가 기준이고 제품 코드의 registry도
두 문서를 따른다.

계산은 사장님 한 명 단위로 돈다. 한 가게의 카드매출, 계좌, 서류, CB, 인터뷰 답을
받아 그 가게의 피처 94개와 점수를 내며, 가게들을 모아 학습하는 모델은 없다.
다른 가게와의 비교는 업종 벤치마크(external-data/, 데이터 담당 브랜치)가 맡는다.

제품 흐름에서 쓰이는 순서.

1. 사장님 동의 후 거래 데이터를 받아 피처를 계산한다
2. 데이터가 조건에 걸리면 인터뷰에서 물을 질문 코드를 낸다
3. 인터뷰 답을 피처로 변환해 2축 점수(현재 상황, 개선가능성)를 낸다
4. CB 심사 의견 옆에 붙일 대조 재료를 만들어 화면에 전달한다
5. 6개월 뒤 거래 데이터만 다시 받아 같은 함수로 목표 피처를 재계산한다

## 설치

```bash
cd donghaeng_finance_ai
python3 -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r modeling/requirements.txt
```

Python 3.9 이상.

## 실행 순서

빈 폴더에서 아래 순서대로 따라 하면 검증까지 끝난다.

```bash
python -m modeling.make_mock      # 1. mock 케이스 10개를 data/mock/ 아래에 생성
python -m modeling.build          # 2. 케이스별 피처 94개 출력
python -m modeling.triggers       # 3. 케이스별 조건부 질문 출력
python -m modeling.validate       # 4. 단계별 완료 확인과 규칙 커버리지, 깨진 입력 검사
python -m modeling.reevaluate     # 5. 재평가 (전 / 후 / 목표값)
python -m modeling.cb_contrast    # 6. CB 대조 dict
python -m modeling.scorecard      # 7. 2축 점수
python -m modeling.external       # 8. 업종 벤치마크 대조 재료
```

## 앱이 받는 JSON

점수, CB 대조, 재평가는 `--json`을 붙이면 앱이 그대로 쓰는 dict를 낸다.
데이터 담당의 `credit_position_lookup.py --json`과 같은 방식이다.

```bash
python -m modeling.scorecard case_operating_drop --json
python -m modeling.cb_contrast case_operating_drop --json
python -m modeling.reevaluate --json
```

문장은 만들지 않는다. 항목 이름, 구간 이름, 값, 산출 근거까지만 내고 사장님에게
보여줄 말은 화면이 만든다. 결측은 `MISSING` 같은 상태 문자열 그대로 나가고,
점수에서 빠진 항목은 `points`가 `null`이며 `excluded`가 `true`다.

| 키 | 뜻 |
|---|---|
| `score` | 축 점수. 산출 가능한 항목이 없으면 `MISSING` |
| `items_used` / `items_total` | 몇 항목으로 산출했는지 |
| `basis` | "5항목 중 4항목으로 산출" |
| `note` | 축 전체에 붙는 표시. 예를 들어 매출 오르내림이 커서 방향 판단 제외 |
| `items[].points` | 항목 점수. 제외면 `null` |
| `items[].excluded` | 산출에서 빠졌는지 |
| `items[].band` | 어느 구간에 들어갔는지 |
| `items[].note` | 그 구간으로 간 근거 값 |

`validate`가 케이스 10개에서 키와 타입을 매번 검사하고, 두 번 실행해 같은지도 본다.

모든 명령은 저장소 루트에서 실행한다. `data/mock/`은 `.gitignore` 대상이라
저장소에 커밋되지 않으므로 `make_mock`을 먼저 돌려야 한다. 시드가 고정돼 있어
몇 번을 다시 돌려도 같은 케이스가 나온다.

## 재현 증거

빈 폴더에 이 저장소만 두고 위 순서대로 돌린 결과다. `external-data/`가 없는 상태라
업종 벤치마크는 전부 MISSING으로 나오고, 그래도 전부 통과한다. 여덟 명령 모두 종료
코드 0이다.

<details>
<summary>python -m modeling.validate</summary>

```
단계 1. mock 케이스 3개
  [PASS] case_customer_drop 입력 7개           7개 다 있음
  [PASS] case_customer_drop expected
  [PASS] case_ticket_drop 입력 7개             7개 다 있음
  [PASS] case_ticket_drop expected
  [PASS] case_operating_drop 입력 7개          7개 다 있음
  [PASS] case_operating_drop expected
  [PASS] 세 케이스 매출 증가율 -20%                  [-0.2, -0.2, -0.2]
  [PASS] expected_features 대조               87개 항목 일치

단계 2. 피처 계산 함수
  [PASS] case_customer_drop 94개 산출          94개
  [PASS] case_customer_drop 빈 값 없음          []
  [PASS] case_ticket_drop 94개 산출            94개
  [PASS] case_ticket_drop 빈 값 없음            []
  [PASS] case_operating_drop 94개 산출         94개
  [PASS] case_operating_drop 빈 값 없음         []
  [PASS] case_operating_drop_after 94개 산출   94개
  [PASS] case_operating_drop_after 빈 값 없음   []

단계 3. 조건부 질문
  [PASS] 영업일 질문은 operating만                 {'case_customer_drop': [], 'case_ticket_drop': [], 'case_operating_drop': ['Q_OPERATING_DAY_DROP']}
  [PASS] 다른 질문은 안 나옴                        {'case_customer_drop': [], 'case_ticket_drop': [], 'case_operating_drop': []}

단계 4. 검증
  [PASS] fin_sales_growth_3m 세 케이스 동일       [-0.2, -0.2, -0.2]
  [PASS] 4피처 조합이 케이스마다 구별
  [PASS] ops_transaction_count_avg_3m 최소 한 케이스 다름 customer_drop=960.0000 / ticket_drop=1,200.0000 / operating_drop=960.0000
  [PASS] ops_avg_ticket_3m 최소 한 케이스 다름      customer_drop=25,000.0000 / ticket_drop=20,000.0000 / operating_drop=25,000.0000
  [PASS] biz_operating_day_count_avg_3m 최소 한 케이스 다름 customer_drop=30.6667 / ticket_drop=30.6667 / operating_drop=23.6667
  [PASS] fin_sales_per_operating_day_3m 최소 한 케이스 다름 customer_drop=782,608.6957 / ticket_drop=782,608.6957 / operating_drop=1,014,084.5070
  [PASS] UNDECIDED가 상태로 남음                  ['own_fund_amount']
  [PASS] 같은 케이스 두 번 계산 일치                   케이스 4개

단계 5. 재평가 계산
  [PASS] 재평가 케이스에 인터뷰 없음
  [PASS] 인터뷰 피처 30개가 상태                     MISSING 30개
  [PASS] 전과 후가 같은 함수                        biz_operating_day_count_avg_3m 전 23.667 후 30.667 목표 29

단계 6. CB 대조 출력
  [PASS] dict 하나로 출력                        키 15개
  [PASS] 문장 생성 안 함                          opinion 원문 그대로

단계 7. 점수 계산
  [PASS] 현재 상황 점수 세 케이스 동일                  [78.0, 78.0, 78.0]
  [PASS] 개선가능성은 operating이 최고               {'customer_drop': 60.0, 'ticket_drop': 60.0, 'operating_drop': 67.5}
  [PASS] 차이는 매출 방향에서만                       ['매출 방향']

단계 11. 케이스 확장과 규칙 커버리지
  [PASS] 케이스 10개가 실물로 있음                    10개
  [PASS] case_no_answer 매출 방향 0점            하락, 사유 없음 원인: 영업일 감소 / 무응답
  [PASS] case_no_answer 계획 0점
  [PASS] case_no_answer 개선가능성 최저            30.0 < 원인 구분 최저 60.0
  [PASS] case_cost_pressure 고정비, 잔액만        ['Q_FIXED_COST_INCREASE', 'Q_LOW_BALANCE']
  [PASS] case_demand_shift 매입, 배달, 주중만      ['Q_PURCHASE_INCREASE', 'Q_DELIVERY_SHARE', 'Q_WEEKDAY_SHARE_CHANGE']
  [PASS] case_interior 잡혀 있는 계약 20점         INTERIOR / 8주 이상, 계약금 확인
  [PASS] case_new_low 현재 상황 0점              현재 상황 0.0점, 5항목 전부 0점
  [PASS] case_volatile 성수기 진술 일치            진술 6~8월, 실제 피크 [6, 7, 8]
  [PASS] case_volatile 오르내림 커서 방향 제외        CV 0.649, 2항목으로 70.0점
  [PASS] 조건부 질문 6개, 나온 사례 있음                6개 전부
  [PASS] 조건부 질문 6개, 안 나온 사례 있음              6개 전부
  [PASS] 스코어카드 미실행 구간                       39/52 구간 실행, 케이스 없는 13개는 선언과 일치
  [PASS] 깨진 입력 빈 카드매출 파일                    완주, 상태 45개
  [PASS] 깨진 입력 빈 계좌 파일                      완주, 상태 36개
  [PASS] 깨진 입력 배달 매출 열 누락                   KeyError 로 계산을 멈춤
  [PASS] 깨진 입력 3개월 이력만                      완주, 상태 22개
  [PASS] 깨진 입력 날짜 뒤섞임                       원본과 94개 전부 일치
  [PASS] 규칙 잡혀 있는 계약, 계약금이 감점이 아님           주 수 9종 확인
  [PASS] 규칙 잡혀 있는 계약, 주 수에 단조               계약금 유무 양쪽에서 단조
  [PASS] 규칙 적자면 부담 비율 분모로 안 씀               적자, 0, 흑자, 결측 확인
  [PASS] 규칙 버틸 수 있는 일수가 음수 아님               음수, 0, 양수 잔액 확인
  [PASS] 규칙 안 정함과 안 물어봄을 구분                 UNDECIDED 0점 / MISSING 제외
  [PASS] 규칙 성수기는 진짜 피크일 때만                  평탄 MISSING / 하락 MISSING / 계절 [6, 7, 8]
  [PASS] 규칙 일손 해소는 데이터로 대조                  일손 증가/평탄/결측 [True, False, False] / 건강 예/아니오 [True, False]
  [PASS] 규칙 업종 코드는 enum 안에서만                enum 11개 안의 값만 통과
  [PASS] 규칙 경계가 같으면 부호만 봄                   음수, 0, 양수 확인
  [PASS] 규칙 외부 null은 MISSING으로              값 1개 유지, null과 빠진 필드와 모르는 업종과 없는 파일은 MISSING
  [PASS] 규칙 계절 질문 경계                        경계 0.17 아래 False / 경계 True / 결측 MISSING
  [PASS] 규칙 업종 격차는 양쪽 있을 때만                 양쪽 있음 -0.2259 / 한쪽 없음 MISSING
  [PASS] 케이스 잔액이 마이너스가 아님                   10개 전부 0 이상
  [PASS] 케이스 진술 매출이 규모에 맞음                  차이 30% 이내

단계 12. 외부 벤치마크 연결
  [PASS] 벤치마크 파일 상태                         없음, 전부 MISSING으로 동작
  [PASS] 피처 94개에 ext_ 없음                    94개 그대로
  [PASS] 벤치마크가 피처와 점수를 안 바꿈                 파일 유무로 케이스 10개 결과 동일
  [PASS] case_interior는 ext_ 전부 MISSING     12필드 전부 MISSING
  [PASS] RESTAURANT 케이스에 벤치마크가 붙음           0개 값
  [PASS] CB 대조에 업종 재료가 실림                   {'ext_peer_sales_growth_3m': 'MISSING', 'ext_sales_growth_gap_peer': 'MISSING', 'seasonality_question_required': 'MISSING'}
  [PASS] CB 대조 두 번 실행 일치

단계 13. 앱이 소비할 JSON 출력
  [PASS] 스코어카드 스키마                          케이스 10개 통과
  [PASS] CB 대조 스키마                          15개 키가 케이스 10개에 전부 있음
  [PASS] 재평가 스키마                            8개 키
  [PASS] JSON 직렬화와 왕복                       케이스 10개 x 2종과 재평가
  [PASS] 같은 입력 두 번 실행 일치                    []
  [PASS] 문장을 만들지 않음                         근거는 값과 구간 이름만

단계 14. 문서와 코드 대조
  [PASS] FEATURE_LIST 코드명 94개               94개 일치
  [PASS] SCORECARD 항목과 만점                   축마다 5항목, 만점 20점, 이름 10개 일치
  [PASS] SCORECARD 구간 경계 숫자                 경계 24개가 문서와 일치

단계 1 통과  (8/8)
단계 2 통과  (8/8)
단계 3 통과  (2/2)
단계 4 통과  (8/8)
단계 5 통과  (3/3)
단계 6 통과  (2/2)
단계 7 통과  (3/3)
단계 11 통과  (32/32)
단계 12 통과  (7/7)
단계 13 통과  (6/6)
단계 14 통과  (3/3)

전체 통과
```

</details>

## 케이스

케이스의 정의와 각 케이스가 무엇을 확인하는지는 [docs/CASES.md](../docs/CASES.md)에 있다.
전부 10개로, 같은 매출 -20%에서 원인(손님 수, 1인당 결제액, 영업일)만 다른 원인 구분 3개,
6개월 뒤 재평가 1개, 인터뷰 무응답 1개, 추가 질문 2개, 업종과 계절 2개,
계속 하락하는 가게 1개이다.

각 케이스가 확인하는 것은 전부 `validate`의 자동 검사로 들어가 있다. validate는
조건부 질문과 스코어카드 구간 중 어느 케이스도 밟지 않은 규칙의 목록도 같이 낸다.

케이스로만 검증하면 그 케이스가 안 밟는 경로는 규칙이 뒤집혀도 통과한다. 그래서
`rule_checks.py`가 규칙 함수에 값을 직접 넣어 확인한다. 규칙이 뒤집히면
케이스와 무관하게 깨진다.

`doc_contract.py`는 문서를 믿지 않고 소스와 대조한다. `docs/FEATURE_LIST.md`의 코드명
94개가 `build.py`의 `FEATURE_ORDER`와 같은지, `docs/SCORECARD.md`의 항목 이름과 구간
경계 숫자가 `thresholds.py`와 같은지 본다. 어느 쪽을 고치고 다른 쪽을 안 고치면 깨진다.

```bash
python -m modeling.doc_contract
```

## 파일

| 파일 | 하는 일 |
|---|---|
| `make_mock.py` | mock 케이스 생성. 시드 고정 |
| `thresholds.py` | 임시 기준값 전부 |
| `common.py` | 결측 상태 값, 증가율, 방향 신호 등 공통 도구 |
| `decompose.py` | 매출 하락의 원인 구분 (손님 수 / 1인당 결제액 / 영업일) |
| `features/card_sales.py` | 카드매출 18개 |
| `features/account.py` | 계좌 18개 |
| `features/card_spend.py` | 카드 사용내역 5개 |
| `features/documents.py` | 서류 6개 |
| `features/cb.py` | CB 1개 |
| `features/interview.py` | 인터뷰 30개 |
| `features/combined.py` | 조합 16개 |
| `build.py` | 케이스 하나를 받아 94개 산출 |
| `triggers.py` | 조건부 질문 판정 |
| `scorecard.py` | 2축 점수 |
| `validate.py` | 검증 스크립트 |
| `rule_checks.py` | 규칙 단위 검사 |
| `broken_inputs.py` | 깨진 입력 테스트 |
| `doc_contract.py` | 문서와 코드 대조 |
| `reevaluate.py` | 6개월 뒤 재평가 표 |
| `cb_contrast.py` | CB 심사 의견 옆에 붙일 값 |
| `external.py` | 업종 벤치마크 연결 |

## 결측 상태

없는 값을 0으로 채우지 않는다. 네 가지 상태를 문자열 그대로 남긴다.

| 상태 | 뜻 |
|---|---|
| `MISSING` | 값이 없거나 계산 불가 |
| `REFUSED` | 사장님이 답을 거부 |
| `NOT_APPLICABLE` | 해당 없는 업종이거나 조건에 안 걸려 묻지 않음 |
| `UNDECIDED` | 다시 물었지만 안 정함 |

## 업종 벤치마크

데이터 담당이 만든 `external-data/peer_benchmark.json`에서 업종별 12필드를 읽는다.
이 저장소에는 그 파일이 없을 수 있고, 없어도 그대로 돌아간다. 두 브랜치의 머지
순서와 무관하게 같은 코드가 동작해야 하기 때문이다. 받아 오려면 아래를 실행한다.

```bash
git checkout origin/feature/external-data -- external-data/
```

### 결측 변환 규칙

외부 파일의 `null`과 이 코드의 `MISSING`을 1:1로 옮긴다. 어느 쪽도 0으로 채우지
않는다. 비어 있다는 사실 자체가 CB가 못 보는 자리를 가리키는 재료이다.

| 외부 파일 | 내부 값 |
|---|---|
| 숫자 | 그대로 |
| `null` | `MISSING` |
| 필드 자체가 없음 | `MISSING` |
| 표에 없는 업종 코드 | 12필드 전부 `MISSING` |
| 파일이 없음 | 12필드 전부 `MISSING` |

`ext_sales_growth_gap_peer`는 사장님 값이 있어야 계산되는 자리라 파일에서는 항상
`null`이다. 그 자리는 `fin_sales_growth_3m - ext_peer_sales_growth_3m`으로 여기서
채우고, 양쪽 중 하나라도 없으면 `MISSING`이다.

### 점수에 넣지 않는다

12필드는 전부 화면에 붙일 대조 재료이다. 피처 94개에도 2축 점수에도 들어가지 않고
`cb_contrast` 출력에만 실린다. 데이터 담당의 계약도 12필드 전부 `context_only`다.
`validate`가 벤치마크 파일을 치웠을 때와 결과가 같은지 매번 확인한다.

변동성 두 필드(`ext_peer_sales_volatility_6m`, `ext_industry_volatility_12m`)는
절대 수준을 판단 재료로 쓰지 않는다. 업종 지수의 변동성이라 가게 한 곳의 변동성과
같은 자로 잴 수 없다. 개별 가게의 오르내림은 업종 평균에서 상쇄된다.

### 계절 질문

`ext_industry_seasonality`가 0.17 이상인 업종이면 계절 질문의 답을 반드시 받는다.
성수기 질문은 항상 묻는 문항에 이미 들어 있으므로, 이 값은 그 답을 비워 두면 안 되는
업종인지를 가릴 뿐 조건부 질문 6개를 늘리지 않는다.
