# 동행금융AI 개발 진척 현황

_기준일: 2026-08-26_

## 제품 범위

동행금융AI는 소상공인 인터뷰에서 나온 사업 정보를 근거와 함께 구조화하고, 종료 시점의 불변 FINAL snapshot을 바탕으로 **인터뷰 데이터 품질**을 검토하는 서비스입니다. 대출 승인·거절, 상품 추천, 공식 또는 추정 신용등급은 만들지 않습니다.

## 구현 완료

### feature_schema_v2 고도화

- 기존 인터뷰 평가 feature registry와 API를 유지한 채, 7개 그룹(사업·재무·채무/신용·운영·사장님 인터뷰·외부 환경·개선가능성)의 `feature_schema_v2` dictionary를 추가했습니다.
- 원천/기간/dtype/결측 정책/방향성/계산 근거를 feature마다 기록하며, 신규 feature는 모두 `modelCandidate: false`입니다. 별도의 신용점수·승인 모델을 추가하지 않습니다.
- 사장님이 직접 말한 매출·고정비·반복고객·목표·기간·측정방식·제약조건은 같은 순수 builder로 변환합니다. 범위값은 중간값으로 바꾸지 않고 missing으로 유지합니다.
- 개선가능성 설명 피처 `imp_recovery_momentum`, `imp_cashflow_stabilization`, `imp_cost_adjustment_headroom`, `imp_sales_recovery_potential`, `imp_plan_specificity`, `imp_plan_feasibility`를 계산합니다.
- 외부/유사업체 데이터는 optional schema만 제공합니다. 외부 API·크롤러를 새로 연결하지 않았고, 값이 없으면 null-safe `MISSING`입니다.
- `buildTrainingFeatureV2`와 `buildInferenceFeatureV2`는 같은 builder의 명시적 별칭이어서 train/inference 계산식이 분리되지 않습니다. feature flag `ENABLE_FEATURE_V2=false`로 전체 v2 산출을 끌 수 있습니다.

### 사용자 경험

- 첫 진입에서 **사장님 인터뷰**와 **관리자 센터**를 분리했습니다.
- 사장님은 이름, 사업체명, 업종을 먼저 입력하고 `전체 흐름`, `비용`, `개선`, `앞으로의 계획` 중 오늘 먼저 이야기할 주제를 고른 뒤 채팅 또는 음성 인터뷰를 선택합니다. 시작점만 바꾸며 기본 업종·매출·답변을 임의로 확정하지 않습니다.
- 대화 화면은 AI 질문과 사장님 답변을 분리해 표시하며, 이전 질문을 다시 듣고 질문·답변 이력을 확인할 수 있습니다.
- 대화로 채워지는 6영역 사업 지도, 근거가 있는 한 줄 정리, 실시간 개선 판, 선택형 답변, 안전한 가정 질문과 `AI가 한 가지 더 궁금해요` 카드를 제공합니다.
- 종료 전에는 근거 기반 개선 후보 3개 또는 건너뛰기를 사장님이 직접 선택합니다. 서버가 같은 후보를 재생성해 제목·출처·근거를 exact 검증한 뒤 append-only 비구속 선택 원장에 저장하며, 확정 목표·평가·신용판단에는 연결하지 않습니다.
- 음성 시작 클릭에서 오디오 출력을 열어 첫 AI 인사와 질문을 자동 재생합니다. 음성 준비 중/재생 중/중지 상태를 구분하고, 재생 중 마이크 잠금·종료 후 자동 청취·끼어들기·다시 듣기를 지원합니다. 짧은 확인 멘트가 준비되는 동안 다음 질문 자동재생을 시작하지 않고, 완료 또는 취소 뒤 최신 질문을 한 번만 재생합니다.

### 음성·AI

- 통화형 음성 우선 경로를 `gpt-realtime-2.1` WebRTC로 추가했습니다. 서버는 tenant·마이크/클라우드 동의를 재검사한 뒤 rate-limited 단기 secret만 발급하고, 브라우저는 `marin` 음성·한국어 `gpt-transcribe`·semantic VAD·끼어들기·실시간 양방향 자막을 처리합니다. 완료 전사만 기존 message command에 한 번 저장하며 다음 질문은 서버 canonical 문장만 발화합니다.
- Realtime 세션이나 협상에 실패하면 기존 loopback faster-whisper/Qwen3-TTS 경로로 자동 전환합니다. `Configure-OpenAI-Key.cmd`는 키를 현재 Windows 사용자 DPAPI 저장소에 보관하고 원클릭 child server에만 주입합니다.
- 브라우저 마이크 입력은 loopback `faster-whisper` 한국어 STT를 통해 실제 전사합니다. 부분 자막과 최종 전사를 분리하며, GPU 추론은 이벤트 루프 밖에서 직렬 실행하고 최종 전사가 대기 중 부분 자막보다 우선합니다. STT가 꺼져 있으면 답변을 임의 생성하지 않고 채팅 전환을 안내합니다.
- AI 질문 음성은 로컬 **Qwen3-TTS 0.6B CustomVoice / Sohee** 저지연 프로필로 합성하며, 웹 앱은 서버 프록시를 통해 오디오만 전달합니다. 정적인 비개인 질문은 모델·목소리 키의 영속 캐시에만 저장하고, 원클릭 실행기는 누락분을 인증된 웹 경로로 모두 준비합니다. 사용자 답변과 동적 개인화 문장은 영속 캐시 대상이 아닙니다. 1.7B는 사전 생성용 선택 모델로 남깁니다.
- 바탕화면 원클릭 실행기는 웹 서비스와 Qwen3-TTS 준비 상태를 함께 확인·기동합니다.
- Claude는 명시 동의(`CLOUD_AI_PROCESSING`)가 있을 때만 사용하며, 기본 모델은 **Sonnet 5**입니다. 서버가 먼저 안전한 다음 질문 후보를 최대 3개로 제한하고 Claude는 그중 하나와 서버 소유의 중립 확인 멘트만 선택합니다. 요청·응답은 `selectedInfoCode/reaction/question` 3필드·192토큰으로 제한하며, 정보 추출·값·근거·상태전이와 실제 저장·표시·재생되는 canonical 질문은 결정론 서버만 확정합니다.
- Sonnet 대화 soft deadline은 실측을 거쳐 8초로 조정했습니다. 6초 비교 실행은 합성 10턴 중 Anthropic 4턴·결정론 fallback 6턴(60%), HTTP 왕복 p50 6,029ms·p95 6,052ms였습니다. clean restart 후 8초 실행은 **Sonnet 5 `tool_use` 10/10, fallback 0%, p50 2,848ms·p95 5,033ms**였습니다. `npm run benchmark:sonnet`은 literal loopback 서버에서 합성 인터뷰 2개·총 10턴을 순차 실행하고 provider/model/stopReason 집계, p50/p95, fallback 비율만 출력하며 API key·provider request ID·답변 원문을 출력하지 않습니다.
- 최근 64개 음성 턴만 브라우저 메모리에서 익명 계측해 말끝→인식→답변 반영→다음 질문과 TTS 첫 바이트·재생 지연의 latest/p50/p95를 계산합니다. 답변 원문·오디오·세션 ID·요청 ID는 계측 snapshot에 포함하지 않습니다.

### 인터뷰 도메인

- 8개 핵심 정보와 선택 보조 신호를 canonical value revision, evidence, 상태 전이로 보존합니다.
- `0`, 모름, 거부, 해당 없음, 범위 값을 구분합니다. 숫자 범위는 중간값으로 임의 치환하지 않습니다.
- 모름 또는 답변 거부는 한 번만 추가 확인한 뒤 `UNAVAILABLE` 또는 `REFUSED`로 종결하고 다음 문항으로 진행합니다.
- 답변에서 이미 확인된 항목은 다시 묻지 않습니다. conflict와 follow-up은 다른 질문보다 먼저 하나만 제시하고, 일반 질문은 현재 사업 단계에서 최대 3개 후보만 만들며 생활재무 질문은 마지막에 둡니다. 답변에 근거가 없는 선택 보조 신호나 업종 가정은 질문에 끼워 넣지 않습니다.
- 매출↔고정비, 개선계획→실행준비, 확정 예약·주문→3개월 전망, 생활비→비상자금 연결을 서버와 TTS 선행 생성에 동일 적용합니다. 네 가지 시작 경로 모두 필수 8개를 중복 없이 수렴하며, 손대지 않은 카페 보조 신호는 질문·진행 지도·사업 지도에서 제외됩니다.
- prefill과 인터뷰 답변의 충돌은 기존값을 덮어쓰지 않고 conflict ledger와 해소 이력을 남깁니다.
- 업종 카탈로그, 목표 후보, 4개 평가축의 PREVIEW/FINAL, feature provenance를 제공합니다.

### 실시간·평가·운영 경계

- transcript finalization, 정보 변경, coverage, feature, summary, 다음 질문을 durable outbox/SSE로 전송하고 순번·재연결·스냅샷 재동기화를 처리합니다.
- tenant-scoped 음성 턴 lease를 SQLite migration 015로 추가해 여러 서버 인스턴스가 같은 음성 턴을 중복 완료하지 못하게 했습니다. 종료·취소 시 내부 전사 저장이 끝나기 전에 lease를 해제하지 않으며 owner CAS와 TTL로 재시작 뒤 복구 경계를 유지합니다.
- FINAL snapshot은 불변이며, 평가는 FINAL만 읽습니다.
- 평가는 `INTERVIEW_DATA_QUALITY_ONLY` 범위이며 `approvalDecision`과 `creditGrade`는 항상 `null`입니다.
- 원천 발화 시각, 정정 이력, evidence, feature 산식, 항목별 품질을 평가 상세에서 확인할 수 있습니다.
- tenant/auth/CAS/idempotency, transcript correction 재처리, consent history, raw audio opt-in, production fail-close 정책을 구현했습니다.

## 검증 현황

- TypeScript typecheck 통과
- ESLint 통과
- Vitest 전체 회귀 **81 files / 522 tests** 통과(네 가지 시작 경로, 동적 후보·단일 추가확인, Realtime event/세션 발급·rate limit, 라이브 Sonnet benchmark의 loopback 제한·CLI 구성·통계·비밀 비출력 경계 포함)
- Next.js production build 통과
- production-mode E2E에서 Sonnet 5 strict-tool 15회, STT/WS, SSE, 11항목 FINAL·평가 목록, 차주 확인 기반 강제 미완료를 확인
- OpenAPI의 실제 route inventory **20 paths / 22 operations**와 filesystem route export가 일치하며, SQLite migration **001~015**의 version·checksum을 회귀 테스트로 확인
- 앱 `http://127.0.0.1:3000`, 로컬 STT `http://127.0.0.1:8765/health`, 로컬 TTS `http://127.0.0.1:8766/health` 기동 확인
- Qwen 고정 질문 음성 캐시 **47/47**, 다시 듣기 UI 전환 약 **308ms**, 실제 local STT 샘플 전사 **0.86초** 확인
- 실제 모바일 폭(312×675) 브라우저에서 시작 주제 카드가 1열로 정렬되고 가로 넘침이 없으며, `앞으로의 계획` 선택 시 첫 질문이 확정 예약·주문으로 진입하는 것을 확인

## 운영 전 필수 게이트

- 공개 운영은 승인된 IdP/MFA, TLS termination, managed database, 모니터링·rate/budget·circuit-breaker가 갖춰지기 전까지 fail-closed입니다.
- 채팅에 노출됐을 가능성이 있는 외부 API 키는 비용 제한 여부와 무관하게 회전해야 합니다.
- 로컬 STT/TTS 모델·가중치, SQLite DB, 로그, 세션, DPAPI 비밀값은 Git에 포함하지 않습니다.
