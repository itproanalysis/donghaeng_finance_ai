# 50개 지시안 요구사항 추적표

이 표는 `donghaeng_ai_interview_codex_50md_v4`의 01~50 지시안을 현재 코드와 검증에 연결합니다.

- **구현**: dev-v1 실행 경로와 자동 테스트가 존재합니다.
- **제한 구현**: 안전한 dev-v1 부분집합은 동작하지만 지시안의 외부 연동·운영 수준 또는 전체 후보군은 아직 없습니다.
- **운영 게이트**: 로컬 합성데이터에서는 동작하지만 운영 투입 전에 대체·보강해야 합니다.

| # | 상태 | 현재 구현과 권위 파일 | 자동 검증 / 남은 경계 |
|---:|---|---|---|
| 01 제품 범위 | 구현 | `src/app`, `src/domain`; 인터뷰 수집·FINAL·보조 데이터 품질만 담당 | 승인·CB·중개는 명시적으로 제외 |
| 02 E2E 흐름 | 구현(dev-v1) | `src/components/interview-workspace.tsx`, `src/server/interview-service.ts`, `server.ts` | production smoke가 인증·동의·OpenAI-compatible multipart STT 경계·SSE와 core 8 + acceptance 11항목→FINAL 평가·목록을 검증; 실제 공급자 한국어 품질은 운영 gate |
| 03 정보구조 | 구현 | `/interviews/{id}` PREVIEW/FINAL, `/interview-evaluations` tenant 평가 목록, `/interview-evaluations/{id}` FINAL 평가 | `src/app/**/page.tsx`, snapshot discriminator/list contract test |
| 04 Live 화면 | 구현 | desktop 19/49/32 3-column 대화·단계·정보패널, caption/waveform, coverage/feature/summary/goal PREVIEW, sticky 완료 bar | 실제 server snapshot/SSE로 갱신; 피쳐와 4대축 직전→현재 데이터품질 변화, 1440/1200/900/600px 브라우저 QA |
| 05 평가 화면 | 구현 | 검색·업종·등급·기간 평가 목록, 차주/사업, 목표, 4대 영역 데이터 품질, feature·정보·근거·transcript 상세 drawer | `evaluation-list.tsx`, `evaluation-report.tsx`; 공식 CB·승인과 분리 |
| 06 도메인 모델 | 구현 | borrower/business/interview/info/revision/conflict/transcript/evidence/final/evaluation/goal/audit | `src/domain`, migrations 001~015, server integration tests |
| 07 필요정보 계약 | 구현(dev-v1) | 필수 core 8개 + allow-listed 선택 보조 3개, TS/JSON Schema/runtime validation, 전체 8~11개, `POST /interviews` RequiredInformationList 수신 | core 각각 정확히 1회·보조 각각 0~1회; 중복/누락/잘못된 초기상태 422 route/contract test |
| 08 Taxonomy | 구현(dev-v1) | core 8개와 보조 3개 모두 4대 영역 primary category 보유; 보조는 현재상황 | catalog validation 및 fixture test; 전체 상용 taxonomy는 미정 |
| 09 상태 머신 | 구현 | 표준 상태, 허용 전이, correction/append-only history | `tests/domain/state-machine.test.ts`, revisions tests |
| 10 Coverage/우선순위 | 구현 | 상태확정·평가가능·필수 확보율, P0/conflict/follow-up/의존성·선호 infoCode 질문 선택 | acceptance에서 단골 follow-up 뒤 개선계획 topic 연속성 검증 |
| 11 마이크 UX | 구현(dev) | 시작/일시정지/재개/답변끝내기/취소/텍스트 fallback, 상태·level·caption | `audio-interview-controls.tsx`; 실제 브라우저 동의·거절·text fallback 검증, OS별 권한 matrix는 운영 게이트 |
| 12 Audio capture | 구현(dev) | getUserMedia 제약, MIME 협상, MediaRecorder 400ms, track/context cleanup | `media-recorder.test.ts`의 협상·bounded replay 정상/경계 테스트; 30분 실브라우저 soak 미실시 |
| 13 Audio transport | 구현(dev) | `/ws/interviews/{id}/audio`, control JSON, length-prefixed binary frame, seq/ACK/resume | `audio-protocol.test.ts`, AsyncAPI; resume는 단일 프로세스 메모리 한정 |
| 14 VAD | 제한 구현 | client level 기반 선택적 1초 silence 종료, 수동 종료 우선; mock speech events | production provider endpointing/server VAD 및 오탐 튜닝 없음 |
| 15 STT adapter | 구현/운영검증 필요 | provider-neutral interface, 개발 mock, production fail-closed OpenAI-compatible multipart adapter와 timeout/bounds/strict response | production E2E는 local multipart stub; 실제 한국어 정확도·latency·streaming partial은 공급자 gate |
| 16 Transcript 확정/수정 | 구현 | partial UI-only, FINAL persistence, timing/confidence/provider, immutable raw + append-only correction와 domain 재파생 hook | route E2E에서 canonical/feature 변화 및 강제실패 전체 rollback 검증 |
| 17 질문 음성 | 구현(dev) | 항상 text 표시, 선택적 browser `speechSynthesis`, `AI_SPEAKING` 동안 capture pause 후 LISTENING/IDLE 복구 | 순수 상태전이 회귀 test; 공급자 TTS/SLA는 없으며 browser voice에 의존 |
| 18 Orchestrator | 구현(dev-v1) | deterministic multi-extraction + provider port, 복합 발화에서 플랫폼 비용·홀 감소·반복고객을 각각 exact evidence span/canonical/state로 검증, transcript-first 실패 보존 | acceptance/악성 structured output/재처리 가능 실패 test; 운영 LLM adapter는 외부 gate |
| 19 다음 질문 | 구현(dev-v1) | priority, dependency, 현재 topic, unresolved·preferred infoCode 기반 한 질문 선택 | “단골 절반”→45% 확인→개선계획 질문의 domain/server 연속성 검증 |
| 20 정량화 follow-up | 구현(dev-v1) | exact/range 보존, “절반”=45~55% semantic range와 `NEEDS_FOLLOWUP`, “45%” exact superseding revision, amount/count/duration/plan/readiness/seasonality follow-up | parser/acceptance tests; 범위 중간값 대체 금지 검증 |
| 21 Pre-fill | 보류 | 새 인터뷰에는 외부 매출·CB·거래 사실을 자동 주입하지 않음 | 승인된 외부 CB/거래 데이터 ingestion·동기화 API 없음 |
| 22 충돌 해소 | 구현(dev-v1) | prefill-vs-answer basis/금액 충돌, 두 candidate 보존, immutable OPEN→RESOLVED ledger, 후속질문·correction resolution revision | unknown/refused 답변은 OPEN 유지; 값 강제 overwrite 금지 회귀 test |
| 23 실시간 이벤트 | 구현 | durable outbox, 12개 event type, batch/seq/version, Last-Event-ID/after replay·gap | READY 평가의 `evaluation.ready`→`interview.completed` 순서까지 DB/OpenAPI/AsyncAPI/client 동기화 |
| 24 Live store | 구현 | duplicate/gap/version 방어, `evaluation.ready` allow-list, batch-final snapshot refresh, 재접속 resync | `live-store.test.ts`, `use-interview-events.test.ts`; 신규 event의 cross-layer drift는 계속 CI 대상 |
| 25 정보 패널 | 구현 | 완료/필요/추가확인/충돌/terminal 그룹, 값·출처·상태 text label | `interview-workspace.tsx`; server snapshot만 렌더링 |
| 26 Live feature/summary | 구현(dev-v1) | 매 턴 PREVIEW feature set과 evidence-linked summary 재계산·저장·event; 보조 발화도 burden/current-state summary에 반영 | acceptance에서 상태/card/feature/summary delta 검증 |
| 27 현재상황 feature | 제한 구현 | 매출·고정비·fixed-cost ratio, 반복고객 비중, 홀 감소 기반 shock 계산; 플랫폼 비용부담은 근거연결 summary | 60개 named catalog 중 계산 경로 없는 이름은 `MISSING/null`, 모델 후보 아님; 시계열·수수료율 등 원천 없음 |
| 28 개선의지 feature | 구현(dev-v1) | plan/problem specificity, 행동수, 기간/측정성, readiness·장애물·자료준비 | 결정론적 입력 존재성/rubric; 감정·음성 confidence 사용 금지 |
| 29 미래전망 feature | 제한 구현 | 4주 확정건수/금액, 예약 coverage 일부, seasonality와 demand evidence | pipeline/계약매출/채널분산 원천 연동 없음 |
| 30 가계 feature | 제한 구현 | 필수 생활비와 buffer months, 0/결측 분리 | 비사업소득·주거비·채무·계좌분리 원천 연동 없음 |
| 31 Feature Registry | 구현 | 실행 registry의 type/range/normalizer/source/missing/model/proxy review/version에 60개 named feature 25/14/12/9를 모두 포함 | 실제 원천 없는 row는 런타임 `MISSING/null`; 명시적 canonical alias 외 유사명/0 대체 금지 test |
| 32 정규화 | 구현(dev-v1) | 한국어 금액·비율·기간 parser, rubric provider는 `level/reason/evidenceIds`만 반환, 서버만 `level/5` 계산 | 악성 normalized/범위 밖 level/미등록 evidence 거부; dev adapter는 결정론 구현 |
| 33 근거·신뢰도 | 구현 | verification, extraction confidence, selected revision, evidence ID와 observed time | FINAL validator와 evidence endpoint로 transcript까지 추적 |
| 34 목표 추출 | 구현(dev-v1) | 차주 발언의 title/baseline/target/period/source, missing field 추적; 직접 전화주문 18→30%, 2개월=8주 acceptance | target-only/period-only follow-up과 한국어 `만원` KRW 단위 회귀 test |
| 35 업종 Goal catalog | 제한 구현 | 생성 UI/API가 11개 업종을 allow-list 선택하고 업종별 정보·목표 후보를 표시, 사업체 snapshot에 업종 저장 | target은 항상 null·차주 확인 전 `SUGGESTED`; parser 없는 업종 후보는 `CATALOG_ONLY`라 완료조건 제외 |
| 36 시즌·상황 Goal | 제한 구현 | 계절성 10개+상황 9개 context catalog와 `BORROWER_HISTORY_FIRST`/`CONTEXT_ONLY` 원칙 | catalog만 존재; live recommendation/과거 데이터 연결·점수 조정 없음 |
| 37 목표수치 | 제한 구현 | 차주 직접 baseline/target/기간/source 우선, 미확정 표시; suggestion 확인 helper | agreed suggestion을 입력받는 runtime command/UI는 없음 |
| 38 인터뷰 완료 | 구현 | strict blocker, 차주 UI 확인 evidence, 사유 필수 FORCE_INCOMPLETE, active turn/final transcript pending 공통 차단 | completion/domain/platform/audio-activity/full journey tests |
| 39 FINAL snapshot | 구현 | dev-v1 version manifest, canonical hash, evidence integrity validator, DB update/delete 차단 | `full-interview.test.ts`, migration/platform tests |
| 40 평가 builder | 구현(dev-v1) | FINAL-only 입력, `PENDING→GENERATING→READY|FAILED`, SAVEPOINT 실패격리, pillar/item/goal artifact, READY durable event | READY/FAILED audit·persistence 및 `evaluation.ready` 순서 test; 운영 비동기 worker/retry는 gate |
| 41 등급/종합지표 | 구현(dev-v1) | 네 영역 충족도+추출 신뢰도+정보 품질+근거 유형으로 재현 가능한 A~E data-quality grade | A~E/UNGRADED 경계 test; `approvalDecision`/`creditGrade` null |
| 42 차주 요약 | 구현 | 7개 section, 문장별 evidence 또는 명시적 gap statement | `live-summary.ts`, FINAL validation |
| 43 평가 상세 UI | 구현 | tenant 평가 목록에서 상세 이동, 560px pillar drawer의 서버 FINAL 기여 feature·필수정보·evidence와 raw/corrected transcript timestamp drill-down | 비기여는 참고로 분리, 기술 산식은 접근 가능한 토글; 모든 등급에 ‘신용등급 아님’ 표시 |
| 44 목표 표시 | 구현(dev-v1) | PREVIEW와 FINAL에 baseline/target/기간/단위/source/origin/context/BehaviorEvent 표시 | 18%→30%·8주·측정원 계보, 미확정 값을 명시하며 임의 목표 생성 금지 |
| 45 API 계약 | 구현 | 19개 runtime HTTP path 전체 OpenAPI(인증된 `/voice/speech` binary 응답 포함), SSE/WS 2개 channel AsyncAPI, JSON API의 공통 `{data,error,meta}` envelope | filesystem runtime route inventory와 OpenAPI path의 정확한 일치, tenant evaluation list의 q/industry/level/from/to 및 실제 evaluation GET 200 Ajv/runtime drift 검사 |
| 46 DB/migration | 구현(dev) | SQLite 15개 migration(001~015), checksum, JSON/CHECK/FK/index/immutable trigger/consent/retention/conflict/outbox tables | 009 `transcript.finalized`, 010 `evaluation.ready`, 014 비구속 개선후보 ledger, 015 audio-turn TTL lease; PostgreSQL/RLS/backup/multi-instance는 gate |
| 47 개인정보·보안 | 운영 게이트 | HttpOnly session, tenant scope, versioned mic consent+WS 재검사, same-origin, rate limits, raw audio 미저장 | external IdP/MFA, TLS, secret manager, 승인 동의문·철회/DSR/retention 필요 |
| 48 지연·오류복구 | 제한 구현 | audio backpressure, 3회 reconnect, bounded replay, SSE gap snapshot resync, text fallback | production smoke가 실제 WS 단절→동일 session/cursor 재접속→final 및 SSE replay 검증; latency SLO·장시간·다중 인스턴스는 운영 게이트 |
| 49 테스트·데모 | 제한 구현 | 12개 SOHO fixture, 11개 업종 profile, 19개 context, runtime 60 named feature, production HTTP/SSE/WS 11항목 acceptance | local multipart STT stub까지 자동화; 실제 브라우저 권한·한국어 마이크 matrix는 별도 필요 |
| 50 최종 DoD | 구현(dev) | core 8+보조3 production E2E, 11항목 multi-extraction→목표→FINAL→evaluation.ready→평가 목록, build/type/lint/test, 실제 브라우저 FINAL 여정 | 실제 STT 공급자 품질·IdP·PostgreSQL·TLS·실마이크 장시간 검증은 `PRODUCTION_GATES.md`의 운영 전환 조건 |

## 핵심 검증 파일

- 전체 canonical 완료 여정: `tests/server/full-interview.test.ts`
- 11항목 acceptance 신호 여정: `tests/domain/acceptance-signal-pipeline.test.ts`, `tests/server/acceptance-signal-pipeline.test.ts`
- 평가 목록 API: `tests/server/evaluation-list.test.ts`
- transaction/CAS/idempotency/tenant/FINAL: `tests/server/platform.test.ts`
- transcript correction: `tests/server/transcript-corrections.test.ts`, `tests/api/transcript-corrections-route.test.ts`
- 8개 parser·revision·feature·goal·completion: `tests/domain/**`
- SSE/audio protocol/store/mock: `tests/realtime/**`
- HTTP route/auth/retention: `tests/api/platform-routes.test.ts`, `tests/server/retention.test.ts`
- 계약 drift: `tests/contracts/openapi.test.ts`, `tests/contracts/asyncapi.test.ts`
- SOHO 경계 fixture: `tests/fixtures/soho-scenarios.test.ts`
- 11개 업종·19개 context·60개 named feature 경계: `tests/domain/soho-industry-context-catalog.test.ts`, `tests/domain/named-feature-catalog.test.ts`

운영 전 남은 항목은 [PRODUCTION_GATES.md](PRODUCTION_GATES.md)를 권위 목록으로 사용합니다.
