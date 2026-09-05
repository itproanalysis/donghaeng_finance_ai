# 동행금융AI 인터뷰

소상공인이 자신의 사업 상황을 직접 설명하고, 상담사가 근거와 데이터 품질을 검토할 수 있게 하는 인터뷰 애플리케이션입니다.

> 이 앱은 대출 승인·거절이나 공식·추정 신용등급을 만들지 않습니다. A~E 표시는 `INTERVIEW_DATA_QUALITY_GRADE_DEV_V1`으로, 인터뷰 정보의 충족도와 추적 가능성만 뜻합니다.

## 제공 기능

- 첫 화면에서 **사장님 인터뷰**와 **관리자 센터**를 분리합니다.
- 사장님은 이름·사업체명·업종을 먼저 입력한 뒤 채팅 또는 실제 마이크 인터뷰를 시작합니다. 시작 전에 사업 사실이나 매출을 자동으로 넣지 않습니다.
- 질문은 현재 확인된 정보, 누락값, 근거와 품질을 바탕으로 서버가 다음 문항을 선택합니다. 사장님 화면에는 대화로 채워지는 6영역 사업 지도, 방금 정리된 한 줄, 개선 판, 근거 기반 선택 질문과 가정 질문, 서버 기록 기반 질문·답변 이력을 보여 줍니다.
- `OPENAI_API_KEY`가 설정된 음성 인터뷰는 `gpt-realtime-2.1`·`marin`과 브라우저 WebRTC로 직접 연결해 스트리밍 음성 입출력, semantic VAD, 자연스러운 끼어들기와 실시간 자막을 제공합니다. 브라우저에는 장기 API 키가 아니라 인터뷰·사용자별 rate limit이 적용된 단기 자격증명만 전달합니다.
- Realtime을 사용할 수 없으면 loopback-only `faster-whisper` 한국어 STT와 Qwen3-TTS 0.6B Sohee로 자동 전환합니다. 어느 경로에서도 임의 답변을 만들지 않으며, 화면 질문·다시 듣기·음성 질문·질문/답변 기록은 서버의 같은 canonical 문장을 사용합니다.
- 인터뷰 Claude 기본은 고정 버전 `claude-sonnet-5`입니다. 서버가 상태·의존성·민감정보 순서로 안전한 다음 질문 후보를 최대 3개만 만들고, Sonnet은 그 안에서 하나를 고른 뒤 짧은 반응을 붙입니다. 요청은 `selectedInfoCode/reaction/question` 3필드·요청별 192토큰으로 제한하고 8초를 넘기면 서버 1순위 질문으로 즉시 이어갑니다.
- Claude 사용 시 답변 원문을 먼저 저장하고, 별도 `CLOUD_AI_PROCESSING` 동의 후에만 짧은 대화 반응을 요청합니다. 정보 추출, 값, 근거, 상태전이와 평가는 Claude가 바꿀 수 없고 서버 결정론 결과만 적용됩니다. 음성 모드는 Claude를 기다리는 동안 캐시된 확인 멘트를 먼저 들려줘 침묵을 줄입니다.
- 인터뷰 종료 전 사장님은 근거 기반 개선 후보 3개 또는 건너뛰기를 직접 선택합니다. 서버가 현재 snapshot으로 후보를 재검증한 뒤 비구속 append-only 기록으로만 저장하며 목표·평가·신용판단에는 사용하지 않습니다.
- 음성 화면은 말끝부터 다음 질문·음성 재생까지의 최근 지연을 원문 없이 계측합니다. 사장님에게는 간단한 연결 상태만 보이고, 접힌 진단에서 latest/p50/p95와 안전 대체 경로 사용 여부를 확인할 수 있습니다.
- PREVIEW 진행 상태는 SSE로 동기화하고, 완료 후에는 불변 FINAL snapshot만으로 데이터 품질 평가를 만듭니다.
- `feature_schema_v2`는 사업·재무·채무/신용·운영·사장님 계획·외부 맥락·개선가능성 변수를 null-safe artifact로 제공합니다. 현재 모델 입력/신용점수/승인 판단에는 사용하지 않으며, `ENABLE_FEATURE_V2=false`로 비활성화할 수 있습니다. 자세한 정의는 [feature_schema_v2](docs/FEATURE_SCHEMA_V2.md)를 참고하세요.

## 로컬 실행

요구 환경은 Node.js 24 이상입니다.

```powershell
cd C:\donghaeng_finance_ai
npm install
Copy-Item .env.example .env.local
npm run dev
```

`npm run dev`는 Next.js, SSE, 오디오 WebSocket을 함께 실행하는 custom server입니다. `dev:next`는 음성 WebSocket을 제공하지 않습니다.

로컬 실행은 `http://127.0.0.1:3000`을 사용합니다. 첫 접속 시 로컬 작업공간 세션을 만들고, 실제 인터뷰는 빈 상태에서 시작합니다. 기본 DB 경로는 `data/donghaeng-ai.db`입니다.

### 실제 음성

바탕화면의 **동행금융AI 실서비스 실행** 아이콘을 한 번 클릭하면 웹 서비스와 안전 대체 경로인 faster-whisper STT·Qwen3-TTS Sohee를 함께 준비하고 브라우저를 엽니다. OpenAI 키가 등록돼 있으면 음성 인터뷰가 `gpt-realtime-2.1` WebRTC를 우선 사용하고, 연결 불가 시 준비된 로컬 엔진으로 자동 전환합니다. 최초 로컬 실행은 정적인 질문 음성 캐시 생성에 몇 분이 걸릴 수 있으며 이후에는 누락분만 확인합니다.

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
npm run build
npm run test:e2e
npm run verify:demo
```

`verify:demo`는 서버를 띄우고 [시연 시나리오](docs/DEMO_SCENARIO.md)의 대본대로 인터뷰를 끝까지 진행한 뒤, 그 결과로 계산한 2축 점수를 기준 케이스와 대조합니다. `modeling/requirements.txt`를 설치한 Python이 필요하며 기본 경로는 `.venv/bin/python`입니다.

`test:e2e`는 production build에서 로컬 Claude/STT stub을 사용해 HTTP, SSE, WS, 동의, 11항목 수집, FINAL, 평가 목록까지 확인합니다. 실제 API 키나 외부 과금은 사용하지 않습니다.

## 문서

- [시연 시나리오](docs/DEMO_SCENARIO.md)
- [AI 작업 방식](docs/AI_WORKFLOW.md)
- [HTTP 계약](contracts/openapi.json)
- [SSE·WS 계약](contracts/asyncapi.json)
- [아키텍처](docs/ARCHITECTURE.md)
- [실시간·음성 경계](docs/REALTIME_BOUNDARY.md)
- [운영 전 차단 조건](docs/PRODUCTION_GATES.md)
