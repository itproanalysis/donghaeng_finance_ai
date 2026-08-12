# 동행금융AI 개발 진척 현황

_기준일: 2026-08-12_

## 제품 범위

동행금융AI는 소상공인 인터뷰에서 나온 사업 정보를 근거와 함께 구조화하고, 종료 시점의 불변 FINAL snapshot을 바탕으로 **인터뷰 데이터 품질**을 검토하는 서비스입니다. 대출 승인·거절, 상품 추천, 공식 또는 추정 신용등급은 만들지 않습니다.

## 구현 완료

### 사용자 경험

- 첫 진입에서 **사장님 인터뷰**와 **관리자 센터**를 분리했습니다.
- 사장님은 이름, 사업체명, 업종을 먼저 입력하고 채팅 또는 음성 인터뷰를 선택합니다. 기본 업종이나 매출을 임의로 확정하지 않습니다.
- 대화 화면은 AI 질문과 사장님 답변을 분리해 표시하며, 이전 질문을 다시 듣고 질문·답변 이력을 확인할 수 있습니다.
- 음성 시작 클릭에서 오디오 출력을 열어 첫 AI 인사와 질문을 자동 재생합니다. 음성 생성 중/재생 중/중지 상태를 구분합니다.

### 음성·AI

- 브라우저 마이크 입력은 loopback `faster-whisper` 한국어 STT를 통해 실제 전사합니다. STT가 꺼져 있으면 답변을 임의 생성하지 않고 채팅 전환을 안내합니다.
- AI 질문 음성은 로컬 **Qwen3-TTS 1.7B CustomVoice / Sohee**로 합성하며, 웹 앱은 서버 프록시를 통해 오디오만 전달합니다.
- 바탕화면 원클릭 실행기는 웹 서비스와 Qwen3-TTS 준비 상태를 함께 확인·기동합니다.
- Claude는 명시 동의(`CLOUD_AI_PROCESSING`)가 있을 때만 질문 표현 및 구조화 보조에 사용합니다. Claude 출력은 스키마, 근거 범위, 결정론적 후보와의 동일성 검증을 통과해야 반영됩니다.

### 인터뷰 도메인

- 8개 핵심 정보와 선택 보조 신호를 canonical value revision, evidence, 상태 전이로 보존합니다.
- `0`, 모름, 거부, 해당 없음, 범위 값을 구분합니다. 숫자 범위는 중간값으로 임의 치환하지 않습니다.
- 모름 또는 답변 거부는 한 번만 추가 확인한 뒤 `UNAVAILABLE` 또는 `REFUSED`로 종결하고 다음 문항으로 진행합니다.
- prefill과 인터뷰 답변의 충돌은 기존값을 덮어쓰지 않고 conflict ledger와 해소 이력을 남깁니다.
- 업종 카탈로그, 목표 후보, 4개 평가축의 PREVIEW/FINAL, feature provenance를 제공합니다.

### 실시간·평가·운영 경계

- transcript finalization, 정보 변경, coverage, feature, summary, 다음 질문을 durable outbox/SSE로 전송하고 순번·재연결·스냅샷 재동기화를 처리합니다.
- FINAL snapshot은 불변이며, 평가는 FINAL만 읽습니다.
- 평가는 `INTERVIEW_DATA_QUALITY_ONLY` 범위이며 `approvalDecision`과 `creditGrade`는 항상 `null`입니다.
- 원천 발화 시각, 정정 이력, evidence, feature 산식, 항목별 품질을 평가 상세에서 확인할 수 있습니다.
- tenant/auth/CAS/idempotency, transcript correction 재처리, consent history, raw audio opt-in, production fail-close 정책을 구현했습니다.

## 검증 현황

- TypeScript typecheck 통과
- ESLint 통과
- Vitest 전체 **60 files / 376 tests** 통과
- Next.js production build 통과
- 앱 `http://127.0.0.1:3000` 및 로컬 TTS `http://127.0.0.1:8766/health` 기동 확인

## 운영 전 필수 게이트

- 공개 운영은 승인된 IdP/MFA, TLS termination, managed database, 모니터링·rate/budget·circuit-breaker가 갖춰지기 전까지 fail-closed입니다.
- 채팅에 노출됐을 가능성이 있는 외부 API 키는 비용 제한 여부와 무관하게 회전해야 합니다.
- 로컬 STT/TTS 모델·가중치, SQLite DB, 로그, 세션, DPAPI 비밀값은 Git에 포함하지 않습니다.
