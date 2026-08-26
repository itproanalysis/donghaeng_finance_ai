# 아키텍처

## 시스템 경계

동행금융AI dev-v1은 Next.js UI/Route Handler, TypeScript 도메인, custom Node HTTP/WebSocket server, Node 내장 SQLite를 한 프로세스 경계에 둔 로컬 합성데이터 애플리케이션입니다. 대출심사·CB 산출·대출중개는 범위 밖입니다.

```text
Browser
  ├─ HTTPS/HTTP ──> Next.js pages + authenticated Route Handlers
  │                  └─ InterviewService / AuthService / RetentionService
  │                      ├─ development: deterministic interview turn planner
  │                      ├─ production: Anthropic Messages API + strict tool planner
  │                      │    └─ server domain validator + staged CAS apply
  │                      ├─ deterministic feature/summary/evaluation engines
  │                      ├─ feature, goal, completion, evaluation lifecycle
  │                      └─ SQLite transaction + command receipt + outbox
  ├─ SSE <────────── durable outbox replay (/api/interviews/{id}/events)
  ├─ WebRTC ────────> OpenAI Realtime gpt-realtime-2.1 / marin
  │                    └─ ephemeral secret는 authenticated Route Handler가 발급
  │                    └─ 완료 전사만 messages API 경로에 합류
  └─ WSS/WS ───────> custom server (/ws/interviews/{id}/audio)
                       └─ env-selected StreamingSttAdapter
                           ├─ development: explicit scripted mock
                           └─ production: OpenAI-compatible multipart STT
                           └─ final transcript만 messages API 경로에 합류

COMPLETE command
  └─ immutable FINAL + canonical content hash
       └─ INTERVIEW_DATA_QUALITY_GRADE_DEV_V1
            └─ FINAL evidence/transcript drill-down
```

`server.ts`가 Next request handler와 fallback `ws` upgrade를 함께 소유합니다. OpenAI가 설정된 브라우저는 WebRTC 통화형 음성을 우선 사용하며 연결 실패 시 로컬 STT/TTS WebSocket 경로로 전환합니다. fallback 음성까지 검증할 때는 `npm run dev`/`npm run start`를 사용해야 합니다. `next dev`만 실행하는 `npm run dev:next`에는 fallback WebSocket server가 없습니다.

## 권위 데이터와 한 턴의 원자성

브라우저의 권위는 항상 서버 snapshot입니다.

1. client는 `text`, `clientMessageId`, `expectedVersion`, `currentQuestionInfoCode`를 보냅니다.
2. 서버는 tenant 소유권, aggregate version, 현재 질문, idempotency key와 `CLOUD_AI_PROCESSING` versioned 동의를 먼저 검사합니다. 동의가 없으면 transcript나 처리 stage를 만들지 않습니다.
3. 첫 SQLite transaction이 FINAL transcript와 `PENDING` command stage를 함께 저장합니다. tenant/interview마다 unresolved stage는 partial unique index로 한 건만 허용하며, 다른 client ID는 transcript/provider 호출 전에 409로 거절합니다. provider 직전에 cloud 동의를 다시 검사한 뒤 5분짜리 DB lease를 원자 획득하므로 여러 Node process가 같은 ID를 동시에 받아도 승자 한 요청만 Claude를 호출합니다. 외부 Claude 요청은 DB transaction을 잡지 않은 상태에서 수행됩니다.
4. Anthropic 응답은 forced single `commit_interview_turn` strict tool call이어야 하고, 서버가 허용 info code, exact evidence span, canonical tagged value와 상태전이를 다시 검증합니다. 정상 출력이면 두 번째 SQLite transaction이 expected version을 CAS하고 evidence, canonical revision, 정보 상태, live feature, aggregate version, command receipt와 outbox batch를 함께 갱신합니다. timeout/network/429/5xx처럼 provider가 명시한 retryable 오류만 lease를 해제하고 transcript와 `PENDING` stage를 보존합니다. 인증·요청·refusal·structured-output/validator 오류와 알 수 없는 오류는 `NON_RETRYABLE_FAILURE`로 stage를 `FAILED` 처리하고 변경 전 version에 안전한 receipt를 저장하므로 같은 ID가 provider를 다시 호출하지 않습니다. 자동 재시도는 하지 않습니다. PENDING transcript의 correction과 PENDING이 있는 COMPLETE/FORCE_INCOMPLETE는 409로 차단합니다.
5. SSE는 `seq` 순서로 commit된 변화를 알립니다.
6. client는 batch의 `isBatchFinal`에서 snapshot을 다시 읽어 투영 간 중간 상태를 렌더링하지 않습니다.

동일 idempotency key와 동일 payload의 재시도는 저장된 응답을 반환합니다. 같은 key를 다른 payload에 재사용하거나 stale version/question을 제출하면 409로 거부합니다. transcript correction도 별도 `clientCorrectionId`, expected version, append-only revision을 사용합니다. Route가 `InterviewService.reprocessTranscriptCorrection`을 동기 hook으로 주입해 corrected effective text에서 새 evidence·선택 canonical revision·legacy 상태/값·live feature/summary·audit·동일 outbox batch를 한 SAVEPOINT/transaction에서 재파생합니다.

## dev-v1 도메인

버전 고정 catalog의 완료 필수 core는 다음 8개 항목입니다.

| 영역 | info code | 확인하는 내용 |
|---|---|---|
| 현재상황 | `monthly_average_sales` | 최근 3개월, 이용 중인 판매 채널을 합친 월평균 매출 |
| 현재상황 | `fixed_operating_costs` | 임차료·인건비·정기구독료처럼 매달 반복되는 운영비 |
| 개선의지 | `improvement_plan` | 가장 먼저 바꾸고 싶은 한 가지와 실행 방법 |
| 개선의지 | `execution_readiness` | 계획을 위해 준비된 것과 아직 막힌 것 |
| 미래전망 | `confirmed_reservations` | 향후 4주 내 확정 예약·주문·수주 건수(0 포함) |
| 미래전망 | `seasonality_outlook` | 향후 3개월 수요 방향과 그 근거 |
| 가계상황 | `essential_household_expenses` | 월 필수 가계지출의 금액 또는 범위 |
| 가계상황 | `emergency_buffer_months` | 비상자금으로 필수 생활비를 감당할 수 있는 기간 |

카페 확장 흐름은 core를 대체하지 않는 다음 3개 선택 보조 항목을 같은 `dev-v1` allow-list에 추가합니다. RequiredInformationList JSON Schema는 core 8개를 정확히 한 번씩 요구하고, 보조 항목은 각각 0~1회만 허용해 전체 8~11개를 받습니다.

| 영역 | info code | 완료 필수 여부 |
|---|---|---|
| 현재상황 | `platform_fee_pressure`, `hall_customer_decline`, `repeat_customer_share` | 선택 보조(`required=false`) |

차주 화면은 시작 전에 `전체 흐름`, `비용 부담`, `개선하고 싶은 점`, `앞으로의 계획` 중 첫 대화 주제를 고를 수 있습니다. 이 선택은 완료 항목을 줄이거나 값을 미리 채우지 않고, 의존성이 없는 첫 `ASKING` 항목만 바꿉니다. 이후 서버는 답한 항목과 자연스럽게 이어지는 짝(매출↔고정비, 개선계획→실행준비, 확정예약→전망, 생활비→비상자금)을 우선하되 기존 conflict/follow-up·의존성·생활재무 마지막 경계를 항상 먼저 적용합니다. 한 답변에서 강한 근거가 나온 다른 항목은 함께 수집해 다시 묻지 않습니다. 모름·거절·불충분 답변은 한 번만 추가 확인하고, 두 번째에도 확인되지 않으면 `UNAVAILABLE` 또는 `REFUSED`로 기록해 다음 질문으로 넘어갑니다. 손대지 않은 선택 보조 항목은 질문 후보뿐 아니라 차주 진행 지도와 사업 지도 분모에서도 제외됩니다.

기본 경로는 `매출 → 고정비 → 개선계획 → 실행준비 → 확정 예약·주문 → 3개월 전망 → 필수 생활비 → 비상자금`입니다. 비용·개선·미래를 시작점으로 고르면 해당 묶음부터 자연스럽게 이어간 뒤 남은 필수 항목으로 수렴합니다. 서버는 매 턴 안전한 후보를 최대 3개만 만들고 Sonnet은 그 범위 안에서 맥락상 가장 자연스러운 다음 항목을 고를 수 있으므로, 기본 경로는 안전한 fallback이지 답변과 무관한 고정 설문 순서가 아닙니다.

각 parser는 exact/range와 값의 의미를 typed canonical value로 보존합니다. 범위를 중간값으로 치환하지 않으며 실제 0을 결측 상태와 분리합니다. canonical revision은 append-only이고 선택 revision, 품질, verification, evidence ID를 함께 보존합니다. “단골은 절반”은 45~55% semantic range와 `NEEDS_FOLLOWUP`으로 저장되고, 후속 “45%”는 앞 revision을 supersede하는 exact 값이 됩니다. “직접 전화주문 비중을 18%에서 30%로 두 달 안에”라는 계획은 baseline 18, target 30, 8주와 측정 source를 보존합니다. 새 인터뷰에는 매출·카드·플랫폼·업종 상황을 자동 prefill하지 않으며, 인터뷰에서 사장님이 확인한 발화와 연결된 evidence만 값의 근거가 됩니다. 차주의 전체매출 진술과 basis 또는 금액이 충돌하면 두 후보를 `CONFLICTING`으로 보존하고 별도 conflict ledger를 `OPEN`으로 남기며, 후속 확인 또는 transcript correction으로 새 resolution revision을 선택할 때만 ledger를 `RESOLVED`로 전이합니다.

Feature Registry는 4개 영역의 실행 feature 정의와 missing policy를 갖고, 명세의 60개 이름(25/14/12/9)을 실제 PREVIEW/FINAL feature set에 모두 포함합니다. core 8개와 수집된 보조 입력으로 계산할 수 있는 원천·파생 feature만 `COMPUTED`가 되며 원천·산식이 없는 항목은 `MISSING/null`, 0분모 등은 `NOT_CALCULABLE`로 남습니다. 동일 canonical 의미의 명시적 alias만 같은 evidence lineage로 투영하며 비슷한 이름, 0, 모델 추정으로 채우지 않습니다. 감정, 목소리 자신감, 표정, 가족구성은 피쳐로 사용하지 않습니다.

오케스트레이터와 0~5 rubric 출력은 신뢰하지 않습니다. 서버는 exact evidence span, canonical tagged value와 상태전이를 결정론적으로 계산하고, conflict→follow-up→normal 우선순위·의존성·사업 phase·생활재무 마지막 규칙을 적용해 다음 질문 후보를 최대 3개로 제한합니다. production 메시지 경로는 server-only `ANTHROPIC_API_KEY`로 고정 버전 `claude-sonnet-5` Messages API를 호출하며, Claude에는 후보 enum과 `selectedInfoCode`, 짧은 `reaction`, `question` 3필드만 허용합니다. 후보 밖 선택이나 검증 실패는 폐기하고 서버 1순위 후보를 적용합니다. 실제 저장·표시·재생 질문은 선택된 info code의 서버 canonical 문장을 유지합니다. 요청별 출력은 192토큰이고 8초 상한을 넘기거나 provider가 실패하면 요청을 취소해 동일한 결정론 결과를 `APPLIED`하며, 늦은 응답은 이미 제시된 질문을 바꿀 수 없습니다. 음성 경로는 이 시간 동안 캐시된 확인 멘트를 병렬 재생합니다. rubric adapter에는 `level`, `reason`, `evidenceIds`만 허용하고 `normalized=level/5`는 feature engine만 계산합니다. feature, LIVE/FINAL summary, 완료 규칙과 `INTERVIEW_DATA_QUALITY_GRADE_DEV_V1` 평가는 결정론적 서버 계산이 권위입니다.

목표는 차주가 말한 개선 계획에서 title, baseline, target, 기간, 단위, 측정 source를 추출합니다. 모두 확인되어야 `CONFIRMED`가 되며 임의 개선률을 보간하지 않습니다. 생성 UI/API는 allow-list된 11개 SOHO 업종을 선택해 사업체 업종을 실제 snapshot에 저장하고 업종별 필요정보·목표 후보를 보여 줍니다. parser/evidence policy가 없는 업종 정보 후보는 `CATALOG_ONLY`라 strict runtime 완료조건에 승격하지 않고, 목표 후보도 `SUGGESTED`/`defaultTarget=null`/차주 확인 필수입니다. 카페 확장 구성은 검증된 보조 3개를 함께 등록하되 자발적 근거가 생긴 항목만 대화에 참여시키고, 다른 업종은 검증된 core 8개로 시작합니다. 계절성 10개와 상황 9개 context는 `BORROWER_HISTORY_FIRST`, `CONTEXT_ONLY`, `modelCandidate=false`라서 그 자체로 점수나 숫자 목표를 바꾸지 않습니다.

## PREVIEW, 완료정책, FINAL

ACTIVE 인터뷰 조회는 `PREVIEW`를 반환합니다. strict `COMPLETE`는 아래 조건이 모두 참일 때만 허용됩니다.

- 필수 core 8개와 allow-listed 선택 보조 항목으로 구성된 dev-v1 catalog, 처리 중인 발화 없음
- 모든 필수 상태가 확정되고 평가 가능한 canonical value/최소 품질/evidence 확보
- 필수·P0 conflict 0건
- completion-required feature가 `COMPUTED` 또는 `NOT_APPLICABLE`
- goal과 numeric target 상태 확정
- UI 명령으로 기록된 차주 최종 확인 evidence

`FORCE_INCOMPLETE`는 평가 불가능한 필수 응답이 남았음을 화면에서 명시하고 차주가 직접 확인한 evidence와 `borrowerConfirmed=true`, 비어 있지 않은 사유가 모두 있을 때만 불변 `FINAL`을 생성합니다. 진행 중인 audio turn 또는 FINAL transcript 영속화가 남아 있으면 COMPLETE와 마찬가지로 거부합니다. 이 경우 evaluation eligibility는 false이고 READY 평가를 만들지 않습니다.

FINAL payload에는 canonical information records, FINAL feature set, goal, evidence-linked summary, transcript, evidence manifest, coverage, 모든 dev-v1 policy version, SHA-256 content hash가 포함됩니다. 저장소는 한 인터뷰당 한 snapshot만 허용하고 update/delete trigger로 변경을 차단합니다. 완료 후 `GET /api/interviews/{id}`도 FINAL payload를 읽으며 PREVIEW를 재구성하지 않습니다.

## 평가의 제한된 의미

현재 평가기는 FINAL snapshot만 입력으로 받습니다. 생성 row는 `PENDING→GENERATING→READY|FAILED`로 감사되며, 네 영역 각각에서 필수정보·필수 feature 충족도와 추출 신뢰도·정보 품질·근거 유형을 조합해 `INTERVIEW_DATA_QUALITY_GRADE_DEV_V1` A~E를 표시합니다. 원천 정보 항목에도 같은 범위의 품질 점수/등급, 출처와 기준시점을 제공하며 이는 신용등급이 아닙니다. READY가 같은 완료 transaction에 저장되면 durable `evaluation.ready`가 `interview.completed`보다 먼저 기록됩니다.

`GET /api/interview-evaluations`는 인증 principal의 tenant에 속한 평가만 목록으로 반환하며 `q`, `industry`, `level`, `from`, `to` 조건을 검증합니다. UI는 차주/사업체/업종, 완료일, 정보수집률, 목표 수, 데이터 품질 등급을 표시하고 검색·업종·등급·기간 필터에서 상세 화면과 560px 근거 drawer로 이동합니다. 목록과 상세 모두 공식 CB 정보나 승인 판단을 합성하지 않습니다.

- `decisionScope`: `INTERVIEW_DATA_QUALITY_ONLY`
- `approvalDecision`: 항상 `null`
- `creditGrade`: 항상 `null`
- incomplete 또는 eligibility 미충족: 평가 미생성 또는 `UNGRADED`

이는 상환능력·부도위험·신용도를 예측하는 모델이 아니며 금융 의사결정에 단독 사용하면 안 됩니다.

## 인증·tenant·요청 출처

모든 업무 API와 WebSocket upgrade는 `donghaeng_session` cookie를 인증하고 tenant 범위로 조회합니다. cookie는 `HttpOnly; SameSite=Lax`, 24시간 수명이며 production에서는 `Secure`가 추가됩니다. mutation은 same-origin 검사를 수행하고 production에서는 Origin을 요구합니다. WebSocket도 production에서 exact Origin을 요구합니다. 다만 현재 외부 IdP가 미구현이므로 public production custom server는 Next 초기화·DB/service 생성·port bind 전에 fail-closed되고, direct Next API도 service-instance와 `AuthService` 양쪽에서 `PRODUCTION_IDP_NOT_CONFIGURED`로 차단됩니다. 로컬 작업공간 password/session은 production 인증 권한이 없습니다.

마이크 버튼은 `MICROPHONE_INTERVIEW` versioned 동의를 먼저 조회하고, 동의가 없으면 처리 목적·선택된 provider·raw audio 미저장을 설명하는 dialog에서 grant/deny 결정을 append합니다. OpenAI Realtime 세션 발급은 `MICROPHONE_INTERVIEW`와 `CLOUD_AI_PROCESSING`을 모두 재검사하고 사용자·인터뷰별 발급 제한을 적용합니다. fallback WebSocket upgrade도 마이크 동의를 다시 확인하므로 UI 우회 capture는 거부됩니다. `OPENAI_API_KEY`는 server-only이며 브라우저에는 단기 secret만 전달합니다. 개발 fallback은 loopback faster-whisper이고 `RAW_AUDIO_STORAGE`는 별도 목적·기본 false이며 현재 저장 기능 자체가 없습니다.

Claude가 설정된 메시지 경로와 OpenAI Realtime 경로는 별도 `CLOUD_AI_PROCESSING` 동의를 deny-by-default로 검사합니다. UI는 외부 AI에 transcript/현재 상태 또는 실시간 음성이 전송된다는 안내를 보여 주고 versioned grant 후에만 시작합니다. 마이크 동의는 cloud 처리 동의를 대신하지 않고, raw audio 저장 동의도 둘과 분리됩니다. `ANTHROPIC_API_KEY`와 `OPENAI_API_KEY`는 요청 payload·응답·provider label·오류에 포함하지 않으며 로컬 실행기는 Windows DPAPI 암호문을 현재 사용자로 복호화해 child server 환경에만 주입합니다. 외부 배포는 승인된 secret manager와 rotation을 별도 적용해야 합니다.

local bootstrap은 합성 `local-workspace-tenant`/`local-workspace-user`만 만들며 production에서는 무조건 거부됩니다. 자동 production E2E만 `DONGHAENG_E2E_AUTH_ALLOW_LOCAL=1`, 서로 일치하는 literal loopback bind host/port/origin, custom server가 검증한 실제 bind의 process-local attestation을 모두 요구하는 좁은 gate로 local workspace identity를 사용할 수 있습니다. 환경 변수만 설정한 direct Next 배포, partial 설정, public/wildcard bind, public origin, port 불일치는 모두 차단되며 이 gate는 배포 인증 mode가 아닙니다. 이 로컬 사용자/password flow는 외부 IdP, MFA, 계정 프로비저닝 또는 운영 RBAC를 대신하지 않습니다.

## 저장소와 migration

`src/server/database.ts`는 현재 migration 001~015를 순서대로 적용하고 migration checksum을 기록합니다. 009는 `transcript.finalized`, 010은 `evaluation.ready` outbox CHECK 재구성, 011은 비동기 message command stage, 012는 `CLOUD_AI_PROCESSING` 동의 목적, 013은 exact retry metadata·단일 PENDING partial unique index·cross-process provider lease, 014는 borrower가 선택한 비구속 개선 후보의 append-only ledger, 015는 tenant-scoped audio-turn TTL lease와 owner-token CAS cleanup을 추가합니다. 기존 migration 내용이 바뀌면 시작을 거부합니다. 파일 DB는 foreign keys, recursive triggers, WAL, `synchronous=FULL`, 5초 busy timeout을 사용합니다.

주요 저장 경계는 다음과 같습니다.

- identity/ownership: tenant, user, auth session, consent record
- live aggregate: interview, required/information item, canonical record
- append-only history: canonical value revision, transcript correction, evidence, information/audit event
- realtime: command receipt, immutable outbox event
- final/evaluation: immutable snapshot, evaluation, pillar/item/goal artifact
- operations: retention policy/run, active/pending audio-turn TTL lease

SQLite는 로컬 단일 프로세스 검증용입니다. PostgreSQL, RLS, 다중 인스턴스 transaction/outbox delivery, backup/restore가 준비되기 전 운영 데이터 저장소로 승인하지 않습니다.

## 실시간 경계

업무 이벤트와 오디오의 순서 공간은 분리합니다.

- SSE: 영속 `seq`, aggregate version, batch metadata, `Last-Event-ID`/`after` replay
- WebSocket: audio session별 `audioSeq`, ACK, 메모리 내 bounded replay/resume

SSE Route Handler는 SQLite outbox를 750ms마다 확인하고 15초 heartbeat를 보냅니다. outbox event는 7일 만료시각을 가지지만 삭제는 ADMIN retention 실행이 필요합니다. 보존 범위를 벗어난 cursor는 409 `EVENT_REPLAY_GAP`과 snapshot URL을 반환합니다.

durable SSE type은 현재 12개이며 `evaluation.ready`도 server enum, DB CHECK, OpenAPI/AsyncAPI, client listener/live store에 함께 등록되어 있습니다. 이는 READY 평가 ID와 제한된 decision scope를 알리는 변화 신호이고, client는 batch 종료 후 권위 snapshot/평가 API를 다시 읽습니다.

오디오 session resume 상태는 현재 한 Node 프로세스 메모리에만 존재하므로 프로세스 재시작이나 다른 인스턴스로의 재연결을 견디지 못합니다. 자세한 protocol과 mock 한계는 [REALTIME_BOUNDARY.md](REALTIME_BOUNDARY.md)에 있습니다.

## 개인정보·보존의 현재 동작

raw audio를 저장하는 schema나 파일 writer는 없습니다. Realtime audio는 동의 후 브라우저에서 OpenAI로 직접 전송되어 앱 서버를 통과하지 않으며, fallback은 브라우저 replay queue와 server/STT session 메모리에서만 일시 처리하고 종료 시 폐기합니다. 저장되는 것은 FINAL transcript 및 선택적으로 start/end/confidence/provider metadata입니다.

현재 microphone 및 cloud-AI processing consent는 사용자·interview·purpose·문서 version별 append-only decision으로 저장되고 deny-by-default로 capture/외부 처리를 막습니다. 다만 운영 승인 동의문, 동의 관리/철회 UX, 국외이전 검토와 법적 보존은 별도 gate입니다. retention 실행은 만료/철회 auth session과 만료 outbox event만 삭제하며 transcript, evidence, audit, consent history, FINAL은 자동 삭제하지 않습니다.

## 계약

현재 runtime Route Handler는 다음과 같습니다.

| 영역 | method/path | 역할 |
|---|---|---|
| 인증 | `POST /api/auth/bootstrap` | 비운영 합성 identity/password/session 초기화 |
| 인증 | `POST`, `DELETE /api/auth/session`; `GET /api/auth/me` | login, logout, 현재 principal |
| 인터뷰 | `POST /api/interviews`; `GET /api/interviews/{id}` | allow-list 업종+검증된 RequiredInformationList(생략 시 dev catalog)로 생성, 권위 PREVIEW/FINAL 조회 |
| 답변 | `POST /api/interviews/{id}/messages` | CAS·멱등 FINAL transcript/domain turn |
| 정정 | `POST /api/interviews/{id}/transcript-segments/{segmentId}/corrections` | append-only 정정과 원자적 재파생 |
| 완료 | `POST /api/interviews/{id}/complete` | strict COMPLETE 또는 FORCE_INCOMPLETE |
| 실시간 | `GET /api/interviews/{id}/events` | authenticated SSE replay |
| 통화형 음성 | `POST /api/interviews/{id}/realtime-session` | 동의·tenant 재검사 후 rate-limited 단기 WebRTC secret 발급 |
| 동의 | `GET`, `POST /api/interviews/{id}/consents` | 목적별 최신 상태 조회·append-only 결정 |
| 투영 | `GET /api/interviews/{id}/information-items`, `live-features` | 현재 또는 FINAL 정보/feature/summary |
| 평가 목록 | `GET /api/interview-evaluations` | tenant 범위 평가 요약과 facet; `q`, `industry`, `level`, `from`, `to` 필터 |
| 평가 | `GET /api/interview-evaluations/{id}` 및 `pillars`, `goals`, `evidence` | FINAL evaluation과 상세 artifact |
| 운영 | `POST /api/admin/retention` | ADMIN dry-run 또는 만료 session/outbox purge |

모든 JSON API는 성공/실패를 `{ data, error, meta: { requestId } }` envelope로 반환합니다. mutation은 session과 same-origin 검사를 요구합니다.

- `contracts/openapi.json`: 인증, interview command/subresource, consent, PREVIEW/FINAL 조회, SSE, evaluation HTTP 계약
- `contracts/asyncapi.json`: SSE event envelope와 audio WebSocket control/binary/server message 계약

현재 20개 runtime Route Handler path는 모두 OpenAPI path와 대응하며 `tests/contracts`가 filesystem route path·HTTP method·schema·event drift를 검사합니다. 새 route나 event를 추가할 때도 같은 변경에서 계약과 test를 갱신해야 합니다.
