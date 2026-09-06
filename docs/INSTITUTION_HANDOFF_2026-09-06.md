# 금융기관 상담 연결 개선 · 2026-09-06

분석 결과에서 다음 단계로 이동할 때 기존 기관 선택·상담 초안 기능이 연결되지 않았다. 신규 결과 화면과 기존 전체 인터뷰 결과를 모두 금융기관 상담 준비로 연결했다.

## 이용 흐름

인터뷰 → 결과와 원문 근거 확인 → 금융기관 상담 준비 → 기관과 준비자료 선택·저장 → 준비서 인쇄/PDF 또는 근거 포함 JSON → 공식 상담 창구.

개선 계획을 선택하고 실행 기록을 남기면 준비서에 함께 포함된다. 미션 완료나 모든 자료의 확인을 상담 준비의 조건으로 두지 않는다. 미확인 정보는 MISSING/null로 유지한다.

기관 안내는 기존 목록의 [소상공인시장진흥공단](https://www.semas.or.kr/), [지역신용보증재단](https://www.koreg.or.kr/), [신용보증기금](https://www.kodit.or.kr/) 공식 경로를 사용한다. 상품 적합성·지원 자격을 판정하거나 제휴를 주장하지 않는다. 준비서로 거래 은행과의 상담도 준비할 수 있다.

## 구현

- `/consultation/:id`: `InstitutionConsultation`에서 사업 현황·근거·누락·선택 계획·실행 기록을 확인하고 기관과 자료를 선택한다. 변경 내용을 저장한 뒤 인쇄/PDF 또는 JSON을 받는다. 내려받기 직전에 서버에서 최신 기록을 다시 읽는다.
- `InstitutionHandoff`: 사업자 결과, 종료 기록, 보조평가 결과, 운영자 상세와 실행 기록에 공통 진입 버튼을 제공한다. 사례 체험의 종료 화면과 검토 목록에서도 연결한다.
- `GET /api/interviews/:id/consultation-package`: `ConsultationPackageService`가 트랜잭션 안에서 기존 `InterviewService.getDataReview`, `RecoveryService.get`, `ConsultationDraftService.get`을 결합한다. FINAL 이전은 409, 타 방문자 기록은 404다.
- `GET/PUT /api/interviews/:id/consultation-draft`: 기존 초안 저장·낙관적 동시성·재시도·감사 기록을 재사용한다. 기존 ADMIN/INTERVIEWER 권한을 유지하고 비운영자에게는 초안을 반환하지 않는다. 공개 시연 방문자는 기존 체험 역할 안에서 자기 기록을 준비한다.
- `consultation-institutions.ts`: 기존 상담 준비 화면과 신규 화면이 같은 공식 기관 목록을 사용한다.
- `contracts/openapi.json`: 읽기 전용 패키지와 응답 계약을 추가한다. 기존 계약과 서버 변수 계산을 유지한다.
- 첫 화면과 서비스 소개: 사업 설명부터 금융기관 상담까지의 사용자·운영자 과정을 설명한다. 가입·로그인 홍보와 화면의 불필요한 내부 용어를 제거한다. Feature Explorer와 기술 설명에서는 원문 추적·산식·버전 정보를 유지한다.

## 로컬 검증

- `npm run typecheck`: 통과.
- `npm run lint`: 통과.
- `npm test`: 109개 파일, 773개 테스트 통과.
- `npm run build`: 신규 상담 준비 화면과 API를 포함해 성공.
- `npm run test:e2e`: 통과. 데이터 생성·실행 기록·상담 준비 연결 28개 검사 통과. 기존 인증, 방문자 격리, CSRF, SSE, 음성 WS/STT, 정정, FINAL, 평가, 초안 저장/재시작/충돌 검증도 유지했다.
- 신규 서비스 테스트: FINAL 선행조건, 누락 보존, 미션 없이 내보내기, 원문 연결, 기관 선택·일부 자료 보존, 최신 실행 기록, 읽기 후 FINAL/hash/감사 기록 불변, 운영자 초안 접근 분리, 합성 환경 표시를 검증한다.

## 범위

공개 서비스는 Competition Demo / Synthetic Data다. 준비서는 직접 내려받아 이용하며 기관 전송·상담 접수·대출 신청 API 연동은 없다. 실제 금융기관 고객 데이터, 학습된 신용모델, 대출 승인·거절, 자동 신용 재평가, 파일 증빙의 진위 확인을 제공하지 않는다. 인쇄/PDF는 브라우저 인쇄 기능을 사용한다.

## 공개 배포·검증

- 애플리케이션 커밋 `92e74d2`, `feature/service-review-completion` 원격 push 완료.
- Cloud Build `b52333fe-eeb8-4961-bc2d-f1ed32f15614` SUCCESS, 2026-09-06 20:57:45 KST 완료.
- 이미지 `asia-northeast3-docker.pkg.dev/abis-web-platform/donghaeng/app:b52333fe-eeb8-4961-bc2d-f1ed32f15614`, digest `sha256:b3b3d33fa3453fc0a6503576bbe7661253da13c2f1039d30e5476691801fab4a`.
- 공개 심사 VM `donghaeng-review-app` 시작 스크립트 exit 0, `donghaeng-review.service` active, 실제 실행 이미지 일치. 기존 전용 디스크와 DB를 유지했다. 소유자 전용 서비스는 변경하지 않았다.
- 공개 `/`, `/about`, `/judge-demo`, `/review`, `/borrower?entry=sample`, `/api/demo/modeling` HTTP 200 및 새 화면 문구 확인. 전용 health 경로 대신 실제 화면과 API 흐름으로 정상 동작을 확인했다.
- 공개 API 31개 검사 통과. 합성 답변 3개 모두 실제 Anthropic `APPLIED/tool_use` 처리. 기관 선택, 일부 준비자료 저장, 100개 변수·원문 추적·실행 기록 결합, FINAL/hash 불변, 방문자별 상담 준비서 격리를 확인했다.
- 배포 전에 있던 브라우저 기록의 분석값(13개 생성·87개 정보 부족), 실행 근거 3개 ID, 검토 완료 상태가 그대로 유지됐다. 이 기록에서 기관과 자료를 선택·저장하고 실제 JSON 파일(142,506 bytes)을 내려받아 내용을 검증했다.
- 모바일 390×844에서 메뉴 4개 표시, 가로 넘침 없음, 기관 선택과 준비자료 복원, 불필요한 가입·로그인 홍보 문구 제거를 확인했다. 데스크톱 화면 크기는 검증 후 복원했다.
- 인쇄 버튼 호출과 인쇄용 문서 DOM은 확인했다. 인앱 브라우저가 네이티브 인쇄 창을 제공하지 않아 실제 PDF 파일의 렌더링은 검증하지 못했다. JSON 다운로드는 파일까지 검증했다.

공개 주소: [동행금융](https://donghaeng-finance-review-jy5k5cvnjq-du.a.run.app/), [결과·상담 준비](https://donghaeng-finance-review-jy5k5cvnjq-du.a.run.app/review).

실행 증적: [로컬 브라우저](verification/institution-consultation-local-2026-09-06.json), [공개 API 31개 검사](verification/institution-consultation-public-2026-09-06.json), [배포·공개 화면·기록 보존](verification/institution-consultation-deployment-2026-09-06.json). 방문자 쿠키나 외부 서비스 키를 포함하지 않는다. 이후 증적 커밋은 문서만 변경한다.
