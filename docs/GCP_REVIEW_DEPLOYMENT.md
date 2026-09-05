# GCP 심사용 공개 서비스

기준일: 2026-09-05. 공모전 웹사이트 심사용으로 가입·로그인을 제거한 별도 서비스다. 기존 IAP 실제 서비스를 공개로 바꾸지 않았고, 애플리케이션 VM·영구 디스크·런타임 서비스 계정·gateway를 각각 분리했다.

- 공개 주소: https://donghaeng-finance-review-jy5k5cvnjq-du.a.run.app/
- 분석 기본 동선: `/modeling?case=case_operating_drop`
- 기존 소유자 서비스: https://donghaeng-finance-ai-jy5k5cvnjq-du.a.run.app/ — IAP 유지
- 공개 기간 상한: 2026-09-12 00:00 KST

## 심사자가 확인하는 흐름

첫 화면의 **전체 분석 과정 보기**는 고정된 합성 사례로 다음을 보여준다.

1. 카드매출 18, 계좌 18, 카드 사용내역 5, 제출서류 6, CB 1
2. 데이터 변화에서 조건부 질문 6개가 발생하는 이유
3. 인터뷰 답변과 원문 근거를 30개 Feature 상태로 보존하는 과정
4. 결합 Feature 16개를 포함한 총 94개 Vector
5. 서로 합치지 않은 현재 상황/개선가능성 두 축과 각 5개 규칙
6. 항목별 원천 → Feature → 적용 구간 → 배점 lineage
7. 기존 CB 대조와 `ext_*` 업종자료의 `CONTEXT_ONLY` 경계
8. 과거 인터뷰를 재사용하지 않는 동일 Feature 재평가

`/api/demo/modeling`과 `/api/demo/modeling/{caseId}`는 인증 없이 읽을 수 있지만 서버가 허용한 합성 case 10개만 반환한다. 임의 ID나 경로는 404다. Python 계산 결과를 빌드 단계에서 JSON으로 고정하므로 공개 요청마다 Python을 실행하지 않는다.

## 격리 구조

```text
심사자 브라우저
  → Cloud Run donghaeng-finance-review (공개 HTTPS gateway)
  → 전용 VPC
  → donghaeng-review-app VM:3000
     ├─ donghaeng-review-data /data/review.db
     ├─ 방문자별 임의 tenant/user
     └─ 지정 Secret만 런타임 메모리에서 사용
```

- gateway는 외부의 인증·IAP·forwarded identity 헤더를 제거하고 고정 origin으로 전달한다.
- 공개 방문자는 `INTERVIEWER`만 가지며 `ADMIN` 권한과 운영 bootstrap/login을 사용할 수 없다.
- cookie마다 별도 tenant를 부여해 다른 방문자의 인터뷰와 평가를 조회하지 못한다.
- 기존 `donghaeng-finance-ai`, `donghaeng-app`, `donghaeng-data`의 IAP·DB·네트워크 정책은 유지한다.
- review VM은 외부 IP가 없고 gateway 태그에서 3000번으로 들어오는 연결 및 IAP SSH만 허용한다.
- review VM 서비스 계정은 시작 에이전트 상태 기록을 위해 쓰기 전용 `roles/logging.logWriter`만 프로젝트 수준으로 가진다. 로그 읽기나 관리자 권한은 부여하지 않는다.

## 사용량과 비용 경계

공개 모드의 한도는 DB에 영구 기록하므로 컨테이너 재기동으로 초기화되지 않는다.

- 방문자 세션: 하루 300회, 분당 20회; 서비스 전체 하루 300회
- 인터뷰 생성: 방문자 하루 4회, 전체 하루 400회
- AI 대화: 방문자 하루 120회, 전체 하루 2,400회
- TTS: 방문자 하루 100회, 전체 하루 1,600회
- STT: 방문자 하루 160 unit, turn당 4 unit, 전체 하루 1,600 unit
- Realtime: 방문자 하루 2회·분당 6회, 전체 하루 20회, 동시 4회, tenant당 동시 1회
- Realtime 통화 상한: 10분. 서버 종료·기한 sweep에서 provider call도 종료한다.

공개 심사에는 실명, 계좌번호, 주민번호 같은 민감정보를 넣지 않도록 첫 화면에 안내한다. 음성·클라우드 AI 처리는 각 동의를 거친다.

## 모델링 빌드 경계

`Dockerfile.gcp`의 Python stage가 아래 순서로 실행된다.

```text
modeling.make_mock
→ modeling.web_payload
   → 기존 modeling.validate 82/82 검사
   → src/generated/modeling-demo.json
→ Next production build
```

점수 규칙을 TypeScript로 다시 작성하지 않는다. 런타임 Node API와 화면은 생성된 `modeling_web_v1`만 읽는다. parity 테스트는 `case_customer_drop`, `case_ticket_drop`, `case_operating_drop`, `case_no_answer`, `case_new_low`의 94개 Feature와 두 축 결과를 새 Python 실행과 대조한다.

## 검증과 배포

```powershell
$env:PYTHONUTF8='1'
npm run modeling:generate
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
gcloud builds submit . --config=deploy/cloudbuild.gcp.yaml --project=abis-web-platform --async
```

Cloud Build 성공 후 생성된 UUID tag만 `donghaeng-review-app`의 `donghaeng-image` metadata에 지정하고 `deploy/start-gcp-review-vm.sh`를 실행한다. 공개 URL에서는 `/`, `/modeling`, 두 modeling API, 채팅 AI와 TTS를 확인한다. WebRTC는 실제 SDP 교환·서버 hangup까지 자동 검증할 수 있지만 사람의 마이크·스피커 청취 여부는 장치에서 별도로 확인해야 한다.

### 2026-09-05 고정 배포 증적

- Cloud Build: `6f9cc65a-c8fd-4c0c-937c-f9e4f6baf0bd` — `SUCCESS`
- 이미지 digest: `sha256:b7783c07bd2deae979bc070db43dbf5ab957cfab7962b548a597a873acd3d75a`
- VM 컨테이너: 같은 Build ID tag, systemd `active`, Docker `running`
- 시작 로그: 전용 runtime 서비스 계정에 최소 `roles/logging.logWriter` 부여
- 코드 검증: typecheck·lint·build·E2E 통과, Vitest 99개 파일·719개 테스트, Python modeling 82/82, production dependency audit 취약점 0건
- 공개 검증: 홈과 `/modeling` 200, 로그인 문구 없음, 공개 모델링 API 10개 사례·94개 Feature, 기본 사례 점수 78/67.5, `ext_*` 점수 미포함
- 실제 공급자 검증: AI 답변 3.06초, TTS 172,844바이트, WebRTC SDP 수락과 서버 hangup. 실제 마이크·스피커 청취는 주장하지 않는다.

## 정확한 한계

- 모델링 데이터 10개는 고정 시드 mock이며 실제 연체·상환 outcome은 0건이다.
- 두 축은 설명 가능한 deterministic scorecard 시제품이다. 학습모델, 신용평가모델, 연체확률·승인확률 예측이 아니다.
- threshold와 배점 일부는 임시값이며 실제 금융성과 데이터로 검증되지 않았다.
- 업종 benchmark는 화면 대조 전용이고 Feature Vector와 두 축 점수에서 제외한다.
- 인터뷰 제거 전후의 개선가능성은 산출 항목 수가 3/5와 4/5로 달라 환산 분모도 다르다. 표시된 차이를 순수 인과효과로 주장하지 않는다.
- 단일 VM/zone SQLite이므로 고가용성 운영 구성이 아니다.

## 2026-09-05 최종 통합 배포

기획안 반영과 `feature/demo-scenario` 최신 변경을 통합하여 `5dbeaa95-6a8b-4696-b5cc-ea250106539f` 이미지로 공개 review 서비스에 배포했다. 후속 Git push 및 최종 배포 결과는 [9월 6일 배포 기록](RELEASE_2026-09-06.md)을 따른다.
