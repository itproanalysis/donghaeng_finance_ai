# 동행금융AI 인터뷰

소상공인이 자신의 사업 상황을 직접 설명하고, 상담사가 근거와 데이터 품질을 검토할 수 있게 하는 인터뷰 애플리케이션입니다.

> 이 앱은 대출 승인·거절이나 공식·추정 신용등급을 만들지 않습니다. A~E 표시는 `INTERVIEW_DATA_QUALITY_GRADE_DEV_V1`으로, 인터뷰 정보의 충족도와 추적 가능성만 뜻합니다.

## 제공 기능

- 첫 화면에서 **사장님 인터뷰**와 **관리자 센터**를 분리합니다.
- 사장님은 이름·사업체명·업종을 먼저 입력한 뒤 채팅 또는 실제 마이크 인터뷰를 시작합니다. 시작 전에 사업 사실이나 매출을 자동으로 넣지 않습니다.
- 질문은 현재 확인된 정보, 누락값, 근거와 품질을 바탕으로 서버가 다음 문항을 선택합니다. 답변의 원문·정정 이력·근거·구조화 값은 함께 보존합니다.
- 마이크 입력은 loopback-only `faster-whisper` 한국어 STT가 실제 녹음을 전사합니다. STT가 꺼져 있으면 임의 답변을 만들지 않고 채팅 전환을 안내합니다.
- AI 질문은 Qwen3-TTS Sohee로 재생하고, 실패할 때만 브라우저의 한국어 음성을 보조로 사용합니다. 음성 인터뷰를 새로 시작하면 첫 질문도 자동으로 읽습니다.
- Claude 사용 시 답변 원문을 먼저 저장하고, 별도 `CLOUD_AI_PROCESSING` 동의 후에만 외부 구조화를 수행합니다. Claude 결과는 서버의 엄격한 스키마·근거·결정론 초안 검증을 통과해야 반영됩니다.
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

바탕화면의 **동행금융AI 실서비스 실행** 아이콘을 한 번 클릭하면 웹 서비스와 Qwen3-TTS Sohee를 함께 준비하고 브라우저를 엽니다. TTS 모델이 없거나 GPU 준비에 실패하면, 소리 없는 인터뷰를 열지 않고 원인을 알려줍니다.

```powershell
Setup-Local-Korean-STT.cmd
Start-Local-Korean-STT.cmd
Setup-Local-Korean-TTS.cmd
```

`Setup-Local-Korean-TTS.cmd`는 최초 한 번만 필요합니다. 그 뒤 Qwen3-TTS는 원클릭 실행기가 자동으로 시작·재사용합니다. STT는 별도 실제 마이크 전사가 필요할 때만 `Start-Local-Korean-STT.cmd`로 켭니다.

- STT: `http://127.0.0.1:8765/v1/audio/transcriptions`의 실제 local `large-v3-turbo` faster-whisper
- TTS: `http://127.0.0.1:8766`의 Qwen3-TTS Sohee

로컬 음성 서비스가 준비되지 않은 경우, 앱은 가짜 전사나 임의 답변을 만들지 않습니다.

### Claude 구조화 사용

`Configure-Claude-Key.cmd`로 키를 등록한 뒤 `Start-Donghaeng-AI-Claude.cmd`로 로컬 서버를 시작할 수 있습니다. 키는 브라우저·소스·`.env`에 넣지 않고 현재 Windows 사용자 범위의 DPAPI 저장소에서 child process 환경으로만 전달합니다. 채팅에 노출된 키는 제한 설정과 별개로 폐기·회전해야 합니다.

Claude는 정보 추출·질문 표현 보조만 맡습니다. 음성 인식, 정보 상태 전이, 점수화, 근거 검증, 완료 판정과 평가는 서버의 결정론적 정책으로 고정합니다.

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
```

`test:e2e`는 production build에서 로컬 Claude/STT stub을 사용해 HTTP, SSE, WS, 동의, 11항목 수집, FINAL, 평가 목록까지 확인합니다. 실제 API 키나 외부 과금은 사용하지 않습니다.

## 문서

- [HTTP 계약](contracts/openapi.json)
- [SSE·WS 계약](contracts/asyncapi.json)
- [아키텍처](docs/ARCHITECTURE.md)
- [실시간·음성 경계](docs/REALTIME_BOUNDARY.md)
- [운영 전 차단 조건](docs/PRODUCTION_GATES.md)
