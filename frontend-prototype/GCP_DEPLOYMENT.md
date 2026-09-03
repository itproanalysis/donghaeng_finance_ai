# 기존 동행금융 프런트엔드의 GCP 배포

이 배포 대상은 `itproanalysis/donghaeng_finance_ai`의 `frontend-prototype`입니다.
`main`의 `d627a4a`를 기준으로 기존 골목 체험, 유진 인터뷰 화면, 이미지와 질문 음성을 이어갑니다.

## 화면과 검토 순서

1. `/guide`: 심사자가 사장님·관리자의 두 흐름을 한눈에 확인합니다.
2. `/`: 골목에서 사업 변화·지출·준비자료에 관한 세 가지 생각을 선택합니다.
3. `/demo`: 사업체 이름을 입력하고 유진의 세 질문에 답합니다. 답변은 개별 수정 후 직접 확인·완료합니다.
4. `/results`: 골목 선택, 질문·답변 원문, 근거가 연결된 개선 후보를 확인합니다.
5. `/admin`: 같은 기록을 선택해 현황을 분석하고 개선안·담당·점검일·준비자료를 검토합니다.
6. 금융기관 연결에서 공식 상담 채널을 선택하고 상담 준비자료를 내려받습니다.

기록은 브라우저에 저장됩니다. 다른 기기로 옮길 때는 결과에서 `동행금융_인터뷰기록.json`을 내려받아 관리자 화면에서 가져옵니다. 관리자 검토 내용은 새로 확인하도록 가져오기 시 초기화되며, 기존 ID가 있으면 저장된 원문과 검토 내용을 유지합니다. 탭마다 선택한 사례를 분리해 다른 탭에서 사례를 바꿔도 인터뷰 대상이 바뀌지 않습니다.

공유 서버 DB와 운영자 로그인, 실시간 음성 인식, 외부 AI 분석, 대출 접수는 이 프런트엔드 배포에 연결되어 있지 않습니다. 기존 루트 서버의 운영 인증·MFA·managed DB 차단 조건은 유지합니다. 질문 음성은 기존 WAV를 재생하며 카메라는 사용자가 켠 경우 본인 미리보기만 제공합니다. 제안은 답변과 연결된 검토 후보이며 신용평가·금리·한도 예측이 아닙니다.

## 배포 설정

- 프로젝트: `abis-web-platform`
- Cloud Run 서비스: `donghaeng-finance`
- 리전: `asia-northeast3` (서울)
- 런타임: Node.js 24, Nitro `node-server`, 컨테이너 포트 8080
- 리소스: 1 vCPU, 512 MiB, 최소 0 / 최대 2 인스턴스, 동시 요청 40
- 실행 계정: `donghaeng-runtime@abis-web-platform.iam.gserviceaccount.com` (프로젝트 역할 부여 없음)
- 빌드: Cloud Build 소스 배포, 저장소의 Dockerfile 사용
- 비밀 키: 필요 없음. `.env*`, 로컬 DB, 루트 백엔드는 업로드하지 않습니다.

GCP 프로젝트에 활성 결제 계정이 연결되어 있어야 합니다. 스크립트는 상태만 확인하며 결제 계정을 자동 연결하지 않습니다.

## 검증 및 로컬 실행

```powershell
cd frontend-prototype
npm ci
npm run test:journeys
npx tsc --noEmit
npm run lint
npm run build:gcp
npm run test:gcp
$env:HOST = '127.0.0.1'
$env:PORT = '8080'
npm run start:gcp
```

`test:journeys`는 답변 보존·완료 제한·잘못된 기록·근거 연결·기관 자료 생성 조건·파일 전달·탭별 사례 분리를 확인합니다. `test:gcp`는 빌드된 서버를 임시 포트로 실행해 다섯 화면, health, 기존 이미지·질문 음성, 404 응답을 확인합니다. 브라우저 시각·상호작용 검증과 실제 음성 인식 검증은 포함하지 않습니다.

## 배포

```powershell
.\scripts\deploy-gcp.ps1
```

스크립트는 프로젝트를 매번 명시하고 필요한 API와 전용 실행 계정을 준비한 뒤 배포합니다. 기존 `abis-app` 등 다른 Cloud Run 서비스는 수정하지 않습니다. 출력된 URL에서 다섯 화면·health·기존 음성/이미지를 HTTP로 검증합니다.

`Dockerfile`은 빌드된 `.output/server`와 `.output/public`만 실행 이미지에 담습니다. 기존 Sites/Vercel 설정과 의존성 잠금 파일은 유지되며 GCP 빌드는 별도 스크립트로 실행됩니다.
