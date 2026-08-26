# 운영 전 차단 조건

현재 빌드는 로컬 합성데이터와 단일 Node 프로세스에서 dev-v1 흐름을 검증하기 위한 것입니다. 아래 P0 항목이 모두 해소되고 별도 보안·개인정보·모델 거버넌스 승인을 받기 전에는 실제 고객정보를 입력하거나 외부 네트워크에 배포하지 않습니다.

## 현재 존재하는 방어선

이 항목들은 구현되어 있지만 운영 승인을 의미하지 않습니다.

- `HttpOnly; SameSite=Lax` session cookie, production의 `Secure`, 24시간 만료·logout revoke
- 외부 IdP 미구현 상태의 production startup/direct API fail-closed; 로컬 작업공간 password/session 무효화, exact loopback 자동 E2E gate만 예외
- tenant 범위 조회와 DB ownership guard, ADMIN 전용 retention route
- mutation 및 WebSocket same-origin 검사; production에서는 Origin 필수
- message/complete/correction의 expected version과 idempotency receipt
- WebSocket payload·idle·message-rate·client/global connection 상한
- versioned microphone/cloud-AI consent의 append-only grant/deny, WebSocket upgrade 및 Claude stage 이전 재검사
- SQLite transaction 안의 aggregate 변경과 append-only outbox batch
- FINAL transcript + message stage 원자 저장, 단일 PENDING partial unique/DB lease, transaction 밖 Anthropic 호출, strict tool/domain 재검증 후 CAS 적용; 명시적 retryable 오류만 동일 stage/transcript를 수동 재시도하고 terminal 오류는 FAILED+receipt로 재호출 차단
- production의 명시적 `anthropic` provider/API key 요구, 공식 HTTPS endpoint 고정, bounded I/O·timeout·안전한 오류·provider/model/token 메타데이터
- migration 001~015 checksum, FK/CHECK/JSON/단일 PENDING guard, immutable canonical revision/correction/outbox update, 비구속 개선후보 append-only ledger와 tenant-scoped audio-turn TTL lease
- correction의 same-transaction canonical/evidence/feature/summary 재파생과 실패 전체 rollback
- 19개 runtime HTTP path 전체 OpenAPI 대응, 12개 durable SSE type/WS AsyncAPI와 local contract drift test
- FINAL insert validation, SHA-256 content hash, update/delete DB trigger
- raw audio 미저장, partial transcript 미영속, FINAL transcript만 저장
- API 오류의 request ID와 내부 오류 상세 비노출

## P0: Identity와 권한

- [ ] local bootstrap/password 계정을 제거하고 승인된 외부 IdP, MFA, 계정 lifecycle과 session rotation을 연결한다.
- [ ] tenant 선택이 IdP claim에서 단일하게 결정되도록 하고, 사용자 초대·비활성화·role 변경 감사 절차를 만든다.
- [ ] 현재 tenant 단위 접근을 owner/담당자/검토자 역할별 권한으로 세분화하고 모든 route와 evaluation artifact에 동일하게 적용한다.
- [ ] HTTP login/mutation과 SSE에 분산 rate limit, brute-force 방어, session invalidation을 적용한다.
- [ ] CSRF·CORS·Origin allowlist, CSP, HSTS와 기타 security header를 reverse proxy 포함 환경에서 침투 테스트한다.
- [x] 외부 IdP 미구현 상태에서 custom server는 Next/DB/port bind 전에, direct Next route는 service-instance/AuthService에서 production 요청을 fail-closed한다. 기존 로컬 작업공간 DB/session도 사용할 수 없다.
- [ ] 외부 IdP 구현 뒤 `DONGHAENG_LOCAL_BOOTSTRAP=0`, 정확한 `DONGHAENG_APP_ORIGIN`, 승인된 issuer/audience/JWKS/session config 누락 시 fail-closed 검증을 새 production auth mode에 둔다.

`NODE_ENV=production`이면 bootstrap뿐 아니라 local login/session 인증 전체가 차단됩니다. `DONGHAENG_E2E_AUTH_ALLOW_LOCAL=1`은 matching literal loopback host/port/origin과 custom server의 실제 bind attestation을 함께 요구하는 자동 smoke 전용 예외이며, 환경 변수만 설정한 direct Next 배포에서는 허용되지 않습니다. 운영 환경에는 이 값을 설정하면 안 됩니다. 실제 production identity는 아직 없으므로 이 P0가 완료되기 전 외부 배포는 불가능합니다.

## P0: HTTPS/WSS와 secret

- [ ] 승인된 reverse proxy/load balancer에서 TLS 1.2+를 종료하고 HTTP→HTTPS redirect 및 WSS upgrade를 검증한다.
- [ ] proxy의 Host/Origin/forwarded header 신뢰 경계를 고정하고 header spoofing을 테스트한다.
- [ ] 로컬 작업공간 password와 로컬 DPAPI 파일을 포함한 파일 기반 secret을 없애고 Anthropic/STT key를 승인된 secret manager에서 workload identity·least privilege로 주입한다.
- [ ] Anthropic/STT key의 생성·배포·정기 rotation·즉시 revoke runbook을 만들고 채팅·티켓·로그 등 비밀 관리 경계 밖에 노출된 키는 만료일/금액 제한과 무관하게 즉시 회전한다.
- [ ] DB backup, observability, Claude/STT provider로 전달되는 데이터까지 전송·저장 암호화와 key rotation 범위를 문서화한다.

custom `server.ts`는 자체 TLS server가 아닙니다. `NODE_ENV=production`으로 시작하는 것만으로 HTTPS/WSS가 제공되지 않습니다.

## P0: 운영 데이터베이스와 다중 인스턴스

- [ ] SQLite를 PostgreSQL 또는 승인된 운영 RDBMS로 교체하고 migration dry-run/rollback/forward-only 정책을 만든다.
- [ ] tenant RLS 또는 동등한 DB 강제 격리와 애플리케이션 우회 불가 테스트를 추가한다.
- [ ] aggregate CAS, idempotency receipt, transcript/evidence/projection/outbox가 한 DB transaction에 유지되는지 검증한다.
- [ ] outbox delivery/replay를 durable broker 또는 다중 인스턴스 안전 dispatcher로 전환한다.
- [ ] audio resume state를 외부 session store로 이동하거나 sticky routing과 명시적 실패 복구 계약을 둔다.
- [x] active-turn/final-transcript-pending 완료 gate를 tenant-scoped DB TTL lease와 owner-token CAS cleanup에 연결해 다른 애플리케이션 인스턴스의 COMPLETE/FORCE도 조기 FINAL을 막는다. 운영 RDBMS 전환 후 동일 transaction 격리를 다시 부하 검증해야 한다.
- [ ] backup/PITR/restore, 장애조치, schema compatibility, connection pool, capacity/load test를 완료한다.
- [ ] FINAL 불변성과 개인정보 삭제 요구가 충돌할 때 승인된 tombstone/crypto-shredding/법적 보존 절차를 설계한다.

현재 SQLite WAL과 in-memory audio session은 단일 프로세스 로컬 검증에만 적합합니다.

## P0: 개인정보·동의·보존

- [ ] 현재 dev-v1 마이크 동의문을 개인정보·법무가 승인한 목적/항목/보유기간/제3자 STT 전송 문구와 version으로 교체한다.
- [ ] `CLOUD_AI_PROCESSING` 동의문에 Claude로 전송되는 FINAL transcript·인터뷰 상태, 제3자/국외이전, 처리 목적·보유기간·철회 효과를 명시하고 개인정보·법무 승인을 받은 version으로 교체한다.
- [ ] 사용자가 이미 부여한 동의를 조회·철회·만료할 수 있는 관리 UX와 운영자 증적 절차를 추가한다.
- [ ] Claude 처리, 실제 STT provider 전송과 raw audio 저장을 서로 다른 목적 동의로 유지하고, 각 adapter/storage 경계에서도 유효 동의를 재검사한다.
- [ ] 현재처럼 raw audio 미저장을 기본으로 유지한다. 저장 기능을 추가한다면 별도 opt-in, 암호화, 짧은 TTL, 접근감사부터 구현한다.
- [ ] transcript/evidence/audit/FINAL의 목적별 보유기간, legal hold, 열람·정정·삭제 요청, tenant offboarding을 승인받는다.
- [ ] 현재 수동 retention API를 scheduler/운영 runbook/alert와 연결하고 dry-run→승인→purge 증적을 남긴다.
- [ ] 로그, metric, trace, crash report, backup에서 transcript·금액·cookie·원본 request body가 수집되지 않는지 검증한다.
- [ ] 개인정보 영향평가, 공급자 DPA/국외이전 검토, 접근권한 정기검토를 완료한다.

현재 retention service가 자동 삭제하는 것은 만료/철회 session과 만료 outbox뿐입니다. transcript, evidence, audit, consent history, FINAL은 보호 대상으로 남기므로 실제 보유정책이 구현됐다고 볼 수 없습니다.

## P0: 실제 Claude 운영 승인

- [ ] 인터뷰 기본 `claude-sonnet-5`, 명시적 지연 비교용 `claude-haiku-4-5-20251001`, prompt/tool schema를 versioned artifact로 고정하고, 모델 변경·deprecation 때 offline corpus와 shadow/canary 평가를 거치는 변경 승인 절차를 만든다.
- [ ] Anthropic 계약, DPA, 처리 지역·국외이전, 입력/출력 보존과 학습 opt-out, 삭제·사고통지 조건을 개인정보·법무·보안이 승인한다.
- [ ] provider timeout, 401/402/403/429/5xx, DNS/TLS 장애, quota·예산 소진 시 사용자 복구 UX와 운영 alert/runbook을 검증한다. 자동 재시도는 중복·비용 상한과 idempotency 정책이 승인된 뒤에만 추가한다.
- [ ] prompt injection, tool contract 이탈, evidence span 조작, 허용되지 않은 info code/상태전이, 과대 응답, Unicode·한국어 숫자 edge case를 red-team하고 서버 validator fail-closed 회귀를 release gate로 둔다.
- [ ] transcript·금액·API key·원본 provider body가 application/proxy/APM 로그에 남지 않도록 redaction을 검증하고, provider/model/request ID/token/latency/failure code만 최소 관측한다.
- [ ] tenant별 rate limit, concurrency, token/금액 budget, timeout, circuit breaker와 kill switch를 설정하고 spend alert·provider status 대응을 운영한다.
- [ ] Claude 제안이 feature·summary·완료·평가를 우회하지 않으며, `INTERVIEW_DATA_QUALITY_GRADE_DEV_V1`와 승인/신용 판단이 계속 결정론적 서버 경계에 남는지 model별 회귀한다.
- [ ] 최초 `CLOUD_AI_PROCESSING` 동의가 없으면 transcript/stage/provider 호출이 전혀 발생하지 않고, stage 직후 동시 철회·만료에서는 외부 호출 없이 transcript+`PENDING` stage만 안전하게 resume되는 route/E2E 증적을 유지한다.
- [ ] timeout/network/429/5xx만 수동 재시도하고 4xx 인증·refusal·invalid structured output·validator/unknown 오류는 `NON_RETRYABLE_FAILURE` receipt로 같은 ID의 추가 과금을 막는 회귀를 유지한다.
- [ ] 여러 service instance의 같은 ID 경쟁은 DB lease로 provider 1회, 다른 ID 경쟁은 partial unique로 provider 0회임을 검증하고, PENDING 중 correction과 COMPLETE/FORCE_INCOMPLETE가 모두 409인지 검증한다.

현재 구현은 실제 Anthropic Messages API와 strict structured tool adapter를 제공하지만, 이것만으로 외부 고객정보 처리 승인을 뜻하지 않습니다. `Configure-Claude-Key.cmd`의 DPAPI 저장은 한 Windows 사용자용 로컬 시연 편의 기능이고 운영 secret manager가 아닙니다.

## P0: 실제 STT와 음성 안전성

- [ ] 구현된 OpenAI-compatible multipart STT adapter를 승인된 운영 공급자·한국어 녹음 fixture에 연결해 정확도·지연 SLO를 통과시키고, 실시간 partial이 필요하면 별도 streaming adapter를 승인한다.
- [ ] provider 인증 secret, 지역, 보존/학습 opt-out, timeout, quota, retry, circuit breaker와 DPA를 확정한다.
- [ ] MIME/codec matrix, 30분 이상 session, 무음·소음·중복·순서 gap·네트워크 전환·provider 장애를 실제 브라우저에서 검증한다.
- [ ] STT confidence의 의미와 threshold를 공급자별로 정규화하고 낮은 confidence는 확인 질문으로 보낸다.
- [ ] VAD threshold/endpointing을 실제 발화 자료로 튜닝하고 수동 “답변 끝내기”와 텍스트 fallback을 유지한다.
- [ ] TTS가 mic에 재입력되지 않도록 playback/mic gating을 브라우저·장치 matrix에서 검증한다.
- [ ] 정적 canonical 질문은 Qwen3-TTS 1.7B 오프라인 asset으로 사전 생성하고, 미리 만들 수 없는 동적 문장은 0.6B 실시간 fallback으로 분리하는 hybrid 품질·지연 profile을 한국어 음성 fixture와 실제 장치에서 승인한다. model·voice·asset version/cache key와 fallback 관측도 함께 고정한다.

기본 STT는 비활성 상태이며, 준비되지 않았을 때는 어떤 문장도 임의로 전사하지 않습니다. 로컬 실행기는 loopback `faster-whisper`를 OpenAI-compatible adapter에 연결해 실제 음성을 전사합니다. production startup은 `mock`을 거부하고 HTTPS endpoint/key가 있는 승인된 `openai-compatible` provider를 요구하지만, 로컬 모델의 정확도·지연·개인정보 검토를 대신하지 않습니다. 인터뷰 UI에는 현재 선택된 provider 경계를 계속 표시해야 합니다.

Claude Messages API 연결은 텍스트 transcript 처리만 담당하며 STT를 제공하지 않습니다. 로컬 원클릭 실행기는 설치된 loopback `faster-whisper`와 Qwen3-TTS를 모두 health-check한 뒤 화면을 열고, 엔진이 준비되지 않으면 불완전한 음성 인터뷰를 시작하지 않습니다. 운영 배포에서는 별도의 승인된 STT/TTS 가용성·fallback 정책이 필요합니다.

## P0: Transcript correction 운영정책

현재 correction route는 `InterviewService.reprocessTranscriptCorrection`을 주입해 append-only raw/corrected history, 새 evidence, superseding canonical revision, legacy 값/상태, coverage, feature, summary, audit와 outbox를 같은 transaction에서 갱신합니다. feature 재생성 실패 시 transcript부터 outbox까지 rollback하는 route E2E도 있습니다.

- [ ] 정정 권한, 사유 taxonomy, 이중검토, 대량정정 탐지와 감사 조회를 운영 정책으로 승인한다.
- [ ] correction으로 연결 정보 밖의 새 항목이 언급된 경우 자동 반영/검토대기 정책을 정하고 테스트한다.
- [ ] 실패 전체 rollback과 기존 evidence/revision 보존을 release 회귀 gate로 유지한다.
- [ ] FINAL 이후 정정 정책을 별도 amendment snapshot/version으로 설계한다. 현재 ACTIVE segment만 correction할 수 있습니다.

## P0: 평가·목표 거버넌스

- [ ] `dev-v1` catalog/parser/feature/completion/evaluation version을 변경 승인·재현·rollback 가능한 registry로 운영한다.
- [ ] 각 feature의 금지 proxy, 차별 가능성, missing/refused/not-applicable 정책을 법무·리스크·모델 거버넌스가 승인한다.
- [ ] A~E가 오직 인터뷰 데이터 품질임을 API, UI, export, 교육자료에서 일관되게 표시하고 신용등급 오인의 사용성 테스트를 한다.
- [ ] `approvalDecision`과 `creditGrade`가 null이라는 불변 contract 및 downstream의 단독 의사결정 금지를 정책·기술적으로 강제한다.
- [ ] 업종·상황 goal suggestion은 차주 확인 전 목표가 아니며 임의 target을 만들지 않는다는 감사 evidence를 남긴다.
- [ ] 생성 UI/API에서 11개 업종을 allow-list 선택하고 사업체 snapshot에 반영하되, 업종별 필요정보 후보가 아직 `CATALOG_ONLY`이고 계절성 10개·상황 9개가 `CONTEXT_ONLY`인 경계를 실제 수집 workflow와 혼동하지 않도록 version migration·차주 확인 절차를 별도 승인한다.
- [ ] 60개 named feature 중 계산 경로가 없는 `MISSING/null` 항목을 0, 유사 feature 또는 모델 입력으로 대체하지 않는 contract를 유지하고, 새 계산 경로마다 원천·산식·missing policy·편향 검토를 승인한다.
- [ ] 실제 Claude interview planner와 향후 rubric classifier가 structured-output/domain validator를 우회하지 않도록 model/version별 eval 결과를 승인한다. 현재 authoritative rubric/summary/evaluation은 결정론 경계를 유지한다.
- [ ] 평가 policy 변경 시 과거 FINAL을 덮어쓰지 않고 새 evaluation version으로 재현하는 절차를 만든다.

## P0: API·계약·실시간 완결성

- [ ] 현재 local에서 통과하는 OpenAPI/AsyncAPI schema·runtime parser/event enum drift test를 원격 CI의 병합 필수 gate로 강제한다.
- [ ] SSE의 duplicate, out-of-order, batch 중단, 7일 replay expiry, 409 snapshot resync를 브라우저에서 검증한다.
- [ ] 현재 동기화된 `transcript.finalized`·`transcript.corrected`·`evaluation.ready` 포함 server enum/DB CHECK/OpenAPI/AsyncAPI/client listener가 향후에도 한 변경으로 유지되도록 cross-layer CI gate를 둔다.
- [ ] tenant 범위 평가 목록의 검색·facet·기간 필터를 운영 데이터량에서 검증하고 pagination/cursor, query index, 응답 상한, export 권한을 확정한다. 현재 목록 API는 pagination을 제공하지 않습니다.
- [ ] SSE polling/heartbeat와 retention purge 경쟁, slow consumer, 500-event page limit, 대량 interview 부하를 검증한다.
- [ ] reverse proxy buffering/timeouts을 꺼 SSE heartbeat와 WebSocket upgrade가 유지되는지 확인한다.

## Release 검증 증적

최소한 다음 명령이 깨끗한 checkout과 production-like 환경에서 모두 성공해야 합니다.

```powershell
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

추가로 아래 결과를 release artifact에 남깁니다.

- [ ] Chromium/Edge/Safari 지원 범위의 텍스트·마이크 전체 사용자 여정 영상 또는 자동화 report
- [ ] 정상 core 8항목 COMPLETE, 보조 3개를 포함한 11항목 acceptance 여정, 별도 FORCE_INCOMPLETE 여정
- [ ] versioned cloud-AI 동의, Anthropic strict tool 요청/메타데이터, 멱등 replay 시 provider 미재호출, provider 오류 시 transcript 보존·aggregate version 불변
- [ ] 마이크 거절, STT 실패, WS 재연결, SSE gap/expiry, stale version, 중복 command, correction rollback
- [ ] cross-tenant/role/Origin/CSRF/unauthenticated HTTP·SSE·WS 보안 테스트
- [ ] 30분 audio soak, 동시접속/load, DB failover/restore, outbox backlog recovery
- [ ] 접근성, 한국어 숫자·범위·실제 0·거절·충돌·다중추출 회귀
- [ ] 개인정보·보안·모델 거버넌스 승인 서명과 운영 runbook

`npm run test:e2e`는 외부 네트워크·실제 key·과금 없이 production server를 로컬 Anthropic/STT stub에 연결해 adapter 계약을 통과시키는 개발 수직 흐름의 smoke 증적입니다. 실제 provider 품질·운영·보안·실브라우저 검증을 대체하지 않습니다.
