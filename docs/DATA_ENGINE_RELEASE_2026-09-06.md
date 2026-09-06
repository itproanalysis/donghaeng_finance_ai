# Alternative Data Generation Engine · 최종 통합

동행금융AI는 인터뷰를 통해 기존 정형 금융데이터에 없던 사업 맥락을 수집하고, 근거 추적 가능한 Canonical·Feature·Signal과 사업자 다음 행동으로 연결한다. 금융기관의 최종 판단은 사람이 한다.

## A. 구현과 변경 파일

| 목적 | 주요 파일 |
| --- | --- |
| 첫 화면·한 페이지 소개 | `src/components/engine-introduction.tsx`, `service-overview.tsx`, `app-header.tsx`, `src/app/about/page.tsx`, `layout.tsx`, `data-engine.module.css`, `service-polish.css` |
| 실제 3분 기술 데모 | `src/app/judge-demo/page.tsx`, `src/components/judge-demo.tsx`, `src/domain/judge-demo.ts` |
| 원문·Canonical·Feature·Signal·Missingness | `src/components/data-review-panel.tsx`, `src/domain/data-review.ts`, `src/server/data-review.ts`, `interview-service.ts` |
| 기존 사업자·담당자 화면 연결 | `borrower-interview-room.tsx`, `borrower-result.tsx`, `final-interview-record.tsx`, `evaluation-report.tsx`, `api-adapter.ts` |
| FINAL artifact 보존 | `src/domain/final-snapshot-v1.ts`, `src/server/interview-service.ts` |
| Action·Mission·새 Evidence·검토 | `src/components/recovery-journey.tsx`, `three-recovery-journey-scene.tsx`, `src/domain/recovery-journey.ts`, `src/server/recovery-service.ts`, `migrations/018_recovery_evidence.sql` |
| 금융기관 관점 목록·상세 | `src/components/data-review-operator.tsx`, `src/app/review/page.tsx`, `src/app/review/[id]/page.tsx` |
| 공개 진입 | `src/app/borrower/page.tsx`, `borrower-interview-start.tsx`; 공개 환경의 프로필 입력을 합성 사례로 통일 |
| 계약·검증·설명 | `contracts/openapi.json`, `scripts/verify-data-engine.mjs`, `scripts/e2e-smoke.mjs`, `tests/server/data-review.test.ts`, 관련 기존 테스트, README·ARCHITECTURE·FEATURE_SCHEMA_V2 |

신규 화면은 `/judge-demo`, `/review`, `/review/:id`, `/recovery/:id`이다. 새 API는 `GET /api/interviews/:id/data-review`, `GET /api/data-reviews`, `GET/POST /api/interviews/:id/recovery`이다. 기존 API를 바꾸거나 프런트엔드에서 Feature 산식을 복제하지 않았다.

`InterviewService`, Canonical revision·상태 전이·Evidence, dictionary 100개와 기존 improvement pipeline, Anthropic strict tool·fallback, consent·idempotency·SQLite·SSE·음성·기존 평가를 재사용했다. `frontend-prototype` 원본은 보존했고 Three.js 장면만 FINAL 이후 Recovery에 연결했다. P0 연결을 마친 뒤 Three.js를 적용했다.

## B. 실제 서비스 흐름

| 단계 | 코드·API·확인 방법 |
| --- | --- |
| Interview | `JudgeDemo` → 기존 POST `/api/interviews`, `/consents`, `/messages`; 합성 답변도 실제 명령·버전·SSE를 사용 |
| Evidence | 기존 `InterviewService`가 원문·정확한 발췌·Evidence ID를 저장; data-review의 `originalText`로 전체 발화 표시 |
| Canonical | 기존 선택 revision·typed value·status를 노출; 원문→구조화 화면의 revision details에서 확인 |
| Feature | `improvement-feature-pipeline.ts`의 실제 `improvementFeatures`를 `getDataReview`가 투영; 7개 그룹, 값/산식/window/null-safe/modelCandidate/source/근거 표시 |
| Signal | 기존 6개 improvement Feature, 실제 사용한 원천·누락·제약·Why; 원시값을 임의 점수로 환산하지 않음 |
| FINAL | POST `/complete`; 3답변 데모는 확인한 범위를 INCOMPLETE로 보존, v2 artifact를 hash와 함께 고정 |
| Action | 기존 allowlisted 후보와 014 append-only 선택 ledger; Recovery SELECT_ACTION은 FINAL 이후의 직접 선택만 저장 |
| Mission | Recovery ADD_EVIDENCE; 018 별도 immutable table에 자기보고 기록·hash·FINAL 연결, CAS·idempotency·순서 보장 |
| Human Review | `/review/:id`와 Recovery REVIEW; 담당자 역할만 추가 확인 필요/검토 완료 기록, 대출 판단 없음 |

## C. 실제 실행 검증

2026-09-06 로컬 production 산출물 기준:

- `npm run typecheck`: 통과.
- `npm run lint`: 통과.
- `npm test`: **106개 파일 / 763개 테스트 통과**. 기존 테스트 파일을 유지하고 첫 화면·합성 진입·migration의 의도된 변경에 맞춰 기대값을 갱신했다.
- `npm run build`: 통과. 신규 화면 4개와 API 3개가 route manifest에 포함된다.
- `npm run test:e2e`: 통과. 기존 strict-tool adapter 18회, 오디오 WS 재연결/STT metadata, correction, SSE replay, 8개 core·11개 acceptance FINAL/evaluation, forced-incomplete, tenant·CSRF·동의, 상담 초안 재기동 보존을 확인했다.
- 새 데이터 엔진 HTTP E2E: **21개 검사 통과**. 실제 OpenAPI 응답 schema도 AJV로 검증했다.
- `2300만원` → Canonical **23,000,000 KRW** → `fin_sales_avg_3m` **23,000,000** → 선택 revision → 동일 원문을 검증했다.
- 3답변 기준 **13 COMPUTED / 87 MISSING / 0 NOT_CALCULABLE**, 고정비 비율 **0.31**, 반복고객 **0.50**. 미연결 신용정보는 `null/MISSING`이다.
- 새 Evidence 3개를 저장하고 같은 명령을 재전송해 중복이 없는지 확인했다. FINAL hash·Feature 불변, tenant 격리, append-only UPDATE/DELETE 차단, CAS 충돌도 검증했다.
- 브라우저에서 실제 버튼으로 3답변→Feature Explorer·원문→Signal Why→FINAL→Action→Mission 3개→담당자 보완 요청까지 확인했다. 모바일 390×844에서 첫 화면과 Recovery, Three.js 장면 및 가로 넘침 없음을 확인했다.

로컬 음성 E2E는 실제 WebSocket/adapter와 검증용 STT 공급자를 사용한다. 사람의 실제 마이크 음성 품질을 이번 자동 검사만으로 검증했다고 주장하지 않는다.

## D. 배포

대상: 공개 심사용 Cloud Run `donghaeng-finance-review` → VM `donghaeng-review-app`, GCP `abis-web-platform` / `asia-northeast3`. 보호된 소유자 서비스와 분리된 기존 DB·접근 정책을 유지한다.

공개 주소: https://donghaeng-finance-review-jy5k5cvnjq-du.a.run.app/judge-demo

배포 커밋·이미지·health·공개 환경 실제 처리 결과는 배포 검증 후 이 절에 기록한다.

## E. 남은 한계와 정직한 범위

- **학습된 신용모델 없음.** v2는 서버의 결정론적 정보 변환·관측 신호다. 별도 `/modeling`도 예측력이 검증된 ML이 아닌 규칙 시제품이다.
- **금융기관 실데이터 연동 없음.** 합성 프로필과 입력을 실제 API로 처리한다. 100개 사전 중 미연결 입력은 숨기지 않는다. 사업 맥락 문장이 모두 숫자 Feature로 전환되는 것은 아니다.
- **실제 금융 운영 배포 아님.** Competition Demo / Synthetic Data이며 방문자별 데모 세션을 사용한다. 실명·계좌·고객 자료를 받는 운영 서비스라고 주장하지 않는다. 입력 자체의 자동 PII 탐지·차단은 제공하지 않는다.
- **대출 판단 없음.** 승인·거절, 신용등급, 승인/부도 확률을 생성하지 않는다. `INTERVIEW_DATA_QUALITY_GRADE_DEV_V1`은 인터뷰 정보 품질이며 3분 불완전 데모에서는 생성하지 않는다.
- **Recovery는 자기보고 텍스트 Evidence.** 파일 업로드, 증빙 진위 검증, 실제 성과·개선률·자동 신용 재평가는 없다. 향후 재평가에 활용될 수 있는 별도 기록이다.
- 이전 FINAL은 v2가 저장되지 않은 경우 `LEGACY_PROJECTION`으로 표시한다. 새 FINAL만 종료 시점 v2를 payload/hash에 고정한다.
- 공개 데모는 기존 정책에 따라 2026-09-12 00:00 KST까지 열리며 쿠키를 지우면 해당 브라우저의 기록 접근을 복구하는 UX는 없다.
- 공모전 순위는 심사 결과에 달려 있다. 이 릴리스는 정보 생성·근거 추적·실행 연결을 3분 안에 직접 확인할 수 있는 데모를 목표로 한다.
