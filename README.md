# 동행금융AI

[2026-09-05 경쟁력 개선·제출 실행 계획](docs/WINNING_PLAN_2026-09-05.md) · [이번 개선 검증 기록](docs/SERVICE_IMPROVEMENTS_2026-09-05.md)

[공개 화면 완성도 개선](docs/SERVICE_POLISH_2026-09-05.md) · [10개 사례의 모델링 산출 증적](docs/MODELING_EVIDENCE_2026-09-05.md)

[기획안 10장에 맞춘 목표·수행기록·재평가·검토 요약 개선](docs/PLAN_ALIGNMENT_2026-09-05.md)

카드·계좌·서류·CB 같은 정형 금융데이터에서 설명이 필요한 변화를 찾고, 소상공인의 인터뷰를 구조화 변수로 바꿔 함께 평가하는 심사 보조 애플리케이션입니다. Python 원본 모델이 30개 인터뷰 Feature를 포함한 94개 Vector를 만들고, 현재 상황과 개선가능성을 서로 합치지 않은 두 축으로 계산합니다.

> 이 앱은 대출 승인·거절, 공식·추정 신용등급, 연체·승인 확률을 만들지 않습니다. 모델링 화면은 고정 규칙 시제품과 합성 mock 10개를 설명하며 예측력이 검증된 학습모델이 아닙니다. 기존 A~E 표시는 별도의 `INTERVIEW_DATA_QUALITY_GRADE_DEV_V1`으로 인터뷰 정보의 충족도와 추적 가능성만 뜻합니다.

## GCP 서비스

[심사용 공개 웹사이트](https://donghaeng-finance-review-jy5k5cvnjq-du.a.run.app/) — 가입·Google 로그인 없이 접속합니다. 첫 화면의 **서비스 소개**에서 목적과 사용자/운영자 Flow를, **평가 사례 살펴보기**에서 변수 결합 전후의 두 축 결과·산식·항목별 반영을 확인합니다. 심사용 별도 DB·방문자별 격리·사용량 제한을 적용했고 실제 운영 자료와 합치지 않습니다.

[소유자 전용 실제 서비스](https://donghaeng-finance-ai-jy5k5cvnjq-du.a.run.app/) — 허용된 본인 Google 계정과 IAP가 필요합니다. 공개 심사 서비스와 VM·DB·서비스 계정을 분리합니다.

배포·복구·운영 제한은 [GCP 실제 서비스](docs/GCP_LIVE_SERVICE.md), 이번 수정과 검증 증적은 [서비스 점검 결과](docs/SERVICE_AUDIT_2026-09-04.md)를 참조하세요. 이전 공개 체험용 Dockerfile/배포 스크립트는 이 서비스에 사용하지 않습니다.

공모전 목적·공식 양식·실제 검증 절차·미충족 제출 요건은 [2026 금융 AI Challenge 점검](docs/FINANCE_AI_CHALLENGE_2026.md)에 정리했습니다. 제출 URL은 위 공개 심사용 주소를 사용하고, 소유자 전용 URL과 혼동하지 않습니다.

완료/불완전 종료 화면에서 원문 근거와 상태를 담은 상담 메모(TXT)를 내려받거나 브라우저에서 인쇄/PDF 저장을 요청할 수 있습니다. 거절·모름은 추가 확인 항목과 분리하고, 금융기관으로 자동 전송하지 않습니다.

## 제공 기능

- `/modeling`은 심사자가 설명 없이 전체 모델링 흐름을 검토하는 화면입니다. 7개 출처 묶음, 조건부 질문 6개, 인터뷰 Feature 30개, 전체 94개 검색·필터, 결합 Feature 16개, 현재 상황/개선가능성 각 5개 규칙, 원문→변수→구간→점수 lineage, CB 대조, 업종 benchmark의 `CONTEXT_ONLY` 경계와 동일 Feature 재평가를 제공합니다.
- `/modeling?tab=impact`는 10개 사례 각각 정형 48개 변수를 고정한 전후 결과, 10개 평가항목 배점·분모, 94개 변수에서 평가 근거까지의 경로를 제공합니다. `/about`은 목적·전체 과정·사용자/운영자 Flow·현재 범위를 정리한 서비스 소개입니다.
- `/api/demo/modeling`과 `/api/demo/modeling/:caseId`는 빌드 시 Python `modeling/build.py`·`scorecard.py`를 실행해 만든 `modeling_web_v1` 산출물을 제공합니다. 브라우저가 점수나 lineage를 역추론하지 않습니다. 10개 사례의 Python/Web parity, 전후 산식·분모와 artifact checksum을 테스트합니다.

- 첫 화면은 **동행 골목길 입구**입니다. 사장님의 대화와 관리자의 사례 확인·근거 검토·상담 준비를 서로 다른 동선으로 안내합니다. 역할 선택부터 실제 서비스로 연결되며 별도 시연 인터뷰로 우회하지 않습니다.
- `/interviews`의 **골목길 상담소**는 담당 기관에 저장된 인터뷰를 상태·이름으로 찾아 이어보는 관제판입니다. 골목/목록 보기, 다음 확인 항목, 페이지 이동, 조회 시각과 새로고침을 제공합니다. `/demo`, `/demo/borrower`, `/demo/admin`은 실제 화면으로 리다이렉트합니다. 기존 프로토타입 소스는 보존하지만 서비스 진입점에서는 사용하지 않습니다.
- 실제 완료 화면은 사업 정보·답변 근거·미확인 항목·개선 후보를 보여 줍니다. 관리자 평가 상세의 **개선안·상담 초안**에서는 담당자·점검 시점·확인 자료·검토 기관을 서버에 명시적으로 저장하고 다시 불러옵니다. 동시 수정은 버전 충돌로 보호하며, 초안 저장은 FINAL 원본 변경이나 금융기관 전송이 아닙니다.
- 사장님은 호칭·사업체명·업종을 입력하거나 공개 체험용 가상 카페를 선택해 채팅·음성을 시작합니다. 동의는 직접 선택하며 사업 수치나 답변을 자동으로 넣지 않습니다.
- 질문은 현재 확인된 정보, 누락값, 근거와 품질을 바탕으로 서버가 다음 문항을 선택합니다. 사장님 화면에는 대화로 채워지는 6영역 사업 지도, 방금 정리된 한 줄, 개선 판, 근거 기반 선택 질문과 가정 질문, 서버 기록 기반 질문·답변 이력을 보여 줍니다.
- `OPENAI_API_KEY`가 설정된 음성 인터뷰는 `gpt-realtime-2.1`·`marin`과 브라우저 WebRTC로 직접 연결해 스트리밍 음성 입출력, semantic VAD, 자연스러운 끼어들기와 실시간 자막을 제공합니다. 브라우저에는 장기 API 키가 아니라 인터뷰·사용자별 rate limit이 적용된 단기 자격증명만 전달합니다.
- Realtime 연결 오류는 재시도/권한 안내를 먼저 표시하고, 사용자가 선택한 경우에만 문장 단위 음성으로 전환합니다. 보조 STT/TTS는 실행 환경에 따라 로컬 모델 또는 서버에 설정된 OpenAI 경로를 사용합니다. 어느 경로에서도 임의 답변을 만들지 않습니다.
- 인터뷰 Claude 기본은 고정 버전 `claude-sonnet-5`입니다. 서버가 상태·의존성·민감정보 순서로 안전한 다음 질문 후보를 최대 3개만 만들고, Sonnet은 그 안에서 하나를 고른 뒤 짧은 반응을 붙입니다. 요청은 `selectedInfoCode/reaction/question` 3필드·요청별 192토큰으로 제한하고 8초를 넘기면 서버 1순위 질문으로 즉시 이어갑니다.
- Claude 사용 시 답변 원문을 먼저 저장하고, 별도 `CLOUD_AI_PROCESSING` 동의 후에만 짧은 대화 반응을 요청합니다. 정보 추출, 값, 근거, 상태전이와 평가는 Claude가 바꿀 수 없고 서버 결정론 결과만 적용됩니다. 음성 모드는 Claude를 기다리는 동안 캐시된 확인 멘트를 먼저 들려줘 침묵을 줄입니다.
- 인터뷰 종료 전 사장님은 근거 기반 개선 후보 3개 또는 건너뛰기를 직접 선택합니다. 서버가 현재 snapshot으로 후보를 재검증한 뒤 비구속 append-only 기록으로만 저장하며 목표·평가·신용판단에는 사용하지 않습니다.
- 음성 화면은 말끝부터 다음 질문·음성 재생까지의 최근 지연을 원문 없이 계측합니다. 사장님에게는 간단한 연결 상태만 보이고, 접힌 진단에서 latest/p50/p95와 안전 대체 경로 사용 여부를 확인할 수 있습니다.
- PREVIEW 진행 상태는 SSE로 동기화하고, 완료 후에는 불변 FINAL snapshot만으로 데이터 품질 평가를 만듭니다.
- 기존 실시간 인터뷰의 `feature_schema_v2`는 사업·재무·채무/신용·운영·사장님 계획·외부 맥락·개선가능성 변수를 null-safe artifact로 제공합니다. 이는 모델링 브랜치의 94개 `modeling_web_v1`과 이름·목적이 다른 별도 계약이며 둘을 같은 Vector처럼 섞지 않습니다. 현재 신용점수/승인 판단에는 사용하지 않으며 `ENABLE_FEATURE_V2=false`로 비활성화할 수 있습니다. 자세한 정의는 [feature_schema_v2](docs/FEATURE_SCHEMA_V2.md)를 참고하세요.

## 로컬 실행

요구 환경은 Node.js 24 이상이며 모델링 산출물 재생성에는 Python 3.12와 `modeling/requirements.txt`가 필요합니다.

```powershell
cd C:\donghaeng_finance_ai
npm install
python -m pip install -r modeling/requirements.txt
npm run modeling:generate
Copy-Item .env.example .env.local
npm run dev
```

`npm run dev`는 Next.js, SSE, 오디오 WebSocket을 함께 실행하는 custom server입니다. `dev:next`는 음성 WebSocket을 제공하지 않습니다.

로컬 실행은 `http://127.0.0.1:3000`을 사용합니다. 첫 접속 시 로컬 작업공간 세션을 만들고, 실제 인터뷰는 빈 상태에서 시작합니다. 기본 DB 경로는 `data/donghaeng-ai.db`입니다.

### 실제 음성

바탕화면의 **동행금융AI 실서비스 실행** 아이콘을 한 번 클릭하면 웹 서비스와 보조 경로인 faster-whisper STT·Qwen3-TTS Sohee를 함께 준비하고 브라우저를 엽니다. OpenAI 키가 등록돼 있으면 음성 인터뷰가 `gpt-realtime-2.1` WebRTC를 우선 사용합니다. 연결 실패 시 재시도하거나 사용자가 보조 방식을 선택할 수 있습니다. 최초 로컬 실행은 정적인 질문 음성 캐시 생성에 몇 분이 걸릴 수 있으며 이후에는 누락분만 확인합니다.

통화형 Realtime 음성을 활성화하려면 한 번만 다음 명령을 실행합니다. 키는 소스나 `.env`가 아니라 현재 Windows 사용자 범위 DPAPI 암호문으로 저장되고, 원클릭 실행기의 child server 환경에서만 복호화됩니다.

```powershell
.\Configure-OpenAI-Key.cmd
```

```powershell
Setup-Local-Korean-STT.cmd
Start-Local-Korean-STT.cmd
Setup-Local-Korean-TTS.cmd
```

두 Setup 명령은 각 모델을 최초 설치할 때만 필요합니다. 설치가 끝나면 원클릭 실행기가 STT와 TTS를 모두 자동으로 시작·재사용하며, 개별 Start 명령은 엔진만 따로 점검할 때 사용합니다.

웹과 음성 엔진을 이미 실행한 상태에서 캐시만 다시 점검하려면 `npm run voice:prewarm -- --origin http://127.0.0.1:3000`을 사용합니다. 이 명령은 로컬 인증 세션과 `/api/voice/speech` 경로만 사용하며, 사용자 답변이나 동적 개인화 문장은 디스크에 저장하지 않습니다.

- STT: `http://127.0.0.1:8765/v1/audio/transcriptions`의 실제 local `large-v3-turbo` faster-whisper
- TTS: `http://127.0.0.1:8766`의 Qwen3-TTS Sohee
- Realtime: 브라우저 WebRTC → OpenAI `gpt-realtime-2.1` / `marin`; 완료 전사만 기존 message command로 저장

로컬 음성 서비스가 준비되지 않은 경우, 앱은 가짜 전사나 임의 답변을 만들지 않습니다.

### Claude 구조화 사용

`Configure-Claude-Key.cmd`로 키를 등록한 뒤 `Start-Donghaeng-AI-Claude.cmd`로 로컬 서버를 시작할 수 있습니다. 키는 브라우저·소스·`.env`에 넣지 않고 현재 Windows 사용자 범위의 DPAPI 저장소에서 child process 환경으로만 전달합니다. 채팅에 노출된 키는 제한 설정과 별개로 폐기·회전해야 합니다.

원클릭 기본은 **Sonnet 5** 고정 버전입니다. `--quality`는 기존 실행 바로가기와의 호환 별칭이고, 지연 비교가 꼭 필요할 때만 `--fast`로 Haiku 4.5를 명시합니다. Sonnet 요청은 출력 192토큰, 8초 대화 soft deadline을 적용하며 초과 시 같은 서버 검증을 통과한 1순위 질문으로 안전하게 이어갑니다. 음성 인터뷰는 이 호출과 동시에 캐시된 짧은 확인 멘트를 재생해 무응답 대기 시간을 줄입니다.

Claude는 짧은 대화 반응과 서버가 허용한 최대 3개 질문 후보 중 선택만 맡습니다. 음성 인식, 정보 추출, 후보 생성·필터링, 정보 상태 전이, 점수화, 근거 검증, 완료 판정과 평가는 서버의 결정론적 정책으로 고정합니다.

## 환경 변수

| 변수 | 기본값 | 의미 |
|---|---:|---|
| `DONGHAENG_HOST` | `127.0.0.1` | custom HTTP server bind host |
| `DONGHAENG_PORT` | `3000` | HTTP/WS port |
| `DONGHAENG_APP_ORIGIN` | `http://127.0.0.1:3000` | mutation·WebSocket Origin 허용값 |
| `DONGHAENG_DB_PATH` | `data/donghaeng-ai.db` | SQLite 경로 |
| `DONGHAENG_LOCAL_BOOTSTRAP` | `1` | 로컬 작업공간 bootstrap 허용 여부 |
| `DONGHAENG_LOCAL_PASSWORD` | 없음 | 필요할 때만 설정하는 로컬 로그인 비밀번호 |
| `DONGHAENG_ORCHESTRATOR_PROVIDER` | `deterministic` | `deterministic` 또는 `anthropic` |
| `ANTHROPIC_API_KEY` | 없음 | server-only Anthropic 자격증명 |
| `OPENAI_API_KEY` | 없음 | server-only Realtime 세션 발급 자격증명; 브라우저에는 단기 secret만 전달 |
| `DONGHAENG_ANTHROPIC_MODEL` | `claude-sonnet-5` | 승인된 인터뷰 기본; Haiku 4.5는 명시적 지연 비교에만 사용 |
| `DONGHAENG_ANTHROPIC_SOFT_DEADLINE_MS` | `8000` | 초과 시 검증된 서버 1순위 질문으로 이어가는 대화 상한; 음성 경로는 캐시된 확인 멘트를 병렬 재생 |
| `DONGHAENG_ANTHROPIC_MAX_TOKENS` | `2304` | strict tool 응답 출력 상한 |
| `DONGHAENG_STT_PROVIDER` | `disabled` | `openai-compatible`로 local STT 연결 |
| `DONGHAENG_STT_ENDPOINT` | 없음 | local STT endpoint |
| `DONGHAENG_STT_MODEL` | `large-v3-turbo` | local Whisper 모델 |

외부 공개 배포는 아직 승인된 IdP, MFA, 운영 session adapter, TLS termination, managed database가 없으므로 fail-closed됩니다. `npm run start`는 해당 운영 인증 구성이 없으면 port를 열기 전에 종료합니다.

## 검증

```powershell
npm test
npm run typecheck
npm run lint
npm run modeling:generate
npm run build
npm run test:e2e
npm run verify:demo
```

`verify:demo`는 서버를 띄우고 [시연 시나리오](docs/DEMO_SCENARIO.md)의 대본대로 인터뷰를 끝까지 진행한 뒤, 그 결과로 계산한 2축 점수를 기준 케이스와 대조합니다. `modeling/requirements.txt`를 설치한 Python이 필요하며 기본 경로는 `.venv/bin/python`입니다.

`test:e2e`는 production build에서 로컬 Claude/STT stub을 사용해 HTTP, SSE, WS, 동의, 11항목 수집, FINAL, 평가 목록까지 확인합니다. 실제 API 키나 외부 과금은 사용하지 않습니다.

## 문서

- [서비스 전체 체험형 UX 점검·개선 및 검증 기록](docs/SERVICE_EXPERIENCE_REVIEW.md)
- [실제 화면 순회 점검·개선 기록 (2026-09-04)](docs/UI_WALKTHROUGH_2026-09-04.md)

- [GCP 공개 체험 배포](docs/GCP_REVIEW_DEPLOYMENT.md)
- [시연 시나리오](docs/DEMO_SCENARIO.md)
- [AI 작업 방식](docs/AI_WORKFLOW.md)
- [HTTP 계약](contracts/openapi.json)
- [SSE·WS 계약](contracts/asyncapi.json)
- [아키텍처](docs/ARCHITECTURE.md)
- [실시간·음성 경계](docs/REALTIME_BOUNDARY.md)
- [운영 전 차단 조건](docs/PRODUCTION_GATES.md)

- [Feature 통합 및 공개 반영 기록](docs/FEATURE_INTEGRATION_2026-09-05.md)
