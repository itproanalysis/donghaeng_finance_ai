# 금융기관 검토자료 화면 통합 · 2026-09-06

복원한 검토자료 페이지에 긴 보고서, 변수 탐색기, 실행 화면이 연이어 반복되어 검토 순서와 자료 저장 위치가 불분명했다. 기존 정보와 저장 API를 유지하면서 모든 진입 주소를 같은 5단계 작업 화면으로 정리했다.

## 화면

1. **검토 요약**: 사업 현황과 서버가 산출한 지표·Signal을 먼저 확인한다.
2. **변수·근거**: 전체 변수·누락·산식과 원문까지 이어지는 근거를 확인한다.
3. **계획·기록**: 사업자가 선택한 계획과 실제 저장된 수행 기록을 읽는다. 직접 인터뷰의 기록 추가는 기존 Recovery 화면으로 연결한다.
4. **담당자 의견**: 현재 검토 상태와 저장 의견을 확인하고 같은 API로 새 의견을 저장한다.
5. **자료 내보내기**: 포함 내용과 저장 상태를 확인한다. 직접 인터뷰에서는 기존 기관·준비자료·담당자·점검 시점도 저장한다.

데스크톱은 현재 자료·누락 수·검토 상태·다운로드·인쇄를 오른쪽에 고정한다. 모바일은 이를 본문 위로 옮기고 5개 단계 버튼을 두 줄로 표시한다. 문서 전체를 화면에 중복으로 펼치지 않고, 인쇄에는 전체 내용을 유지한다. 확인되지 않은 정보는 계속 누락으로 표시한다.

## 경로와 기존 기능 재사용

| 경로 | 연결 |
| --- | --- |
| `/demo/admin` | 기존 `AdminDemo` → `ModelingWorkflow` → 공통 검토 화면 |
| `/modeling?case=case_operating_drop&review=final` | 동일 검토 화면, 기존 공유 주소 유지 |
| `/modeling?case=case_operating_drop&tab=report&section=evidence` | 동일 화면의 변수·근거 단계 바로 열기 |
| `/demo/admin?interview=:id` | 기존 서버 consultation-package → `InstitutionConsultation` → 공통 검토 화면 |
| `/consultation/:id` | 동일 인터뷰 자료의 내보내기·상담 준비 단계부터 열기 |

- `institution-review-workspace.tsx`, `institution-review.module.css`: 공유 단계 이동·요약 영역·모바일 배치·인쇄 분리. 패널을 유지하여 단계 변경 시 작성 중인 내용이 사라지지 않는다. 키보드 방향키·Home·End를 지원한다.
- `modeling-institution-report.tsx`: 기존 보고서를 요약·근거·계획·의견 단위로 재사용한다. 전체 인쇄 문서도 같은 구성요소에서 만든다. 94개 합성 변수, 기존 규칙과 원문, 최초/후속 분모는 그대로다.
- `interview-review-sections.tsx`: 기존 FINAL Canonical·Signal·Recovery 응답에서 실제 인터뷰 요약과 수행 기록을 표시한다.
- `data-review-panel.tsx`의 `embedded`, `recovery-journey.tsx`의 `reviewOnly`: 기존 변수·근거 탐색과 담당자 검토를 중복 큰 제목이나 전체 실행 화면 없이 삽입한다. 다른 기존 사용처는 유지한다.
- 직접 인터뷰의 `/consultation-package`, `/consultation-draft`, `/recovery` API와 저장 계약은 변경하지 않았다. 저장하지 않은 담당자 의견이 있으면 다운로드·인쇄를 막고, 내보내기 직전에 서버 자료를 다시 읽는다.
- 모델링 사례의 기존 localStorage 키와 의견·확인 상태를 유지했다. 실제 인터뷰의 100개 `feature_schema_v2`와 합성 규칙 사례의 94개 변수는 구분한다. 브라우저에서 평가값을 재계산하지 않는다.

## 실행한 검증

- `npm run typecheck`, `npm run lint`: 통과.
- `npm test`: **110개 파일, 778개 테스트 통과**.
- `npm run build`: production 빌드 통과.
- `npm run test:e2e`: 통과. 복원 주소·기존 공유 주소·단계 직접 주소가 200이고, 검토 화면의 상위 탭이 5개인지를 추가 확인했다. 기존 인터뷰 생성·근거 추적·격리·동의·SSE·음성·FINAL·충돌 검사를 유지했다.
- 보고서 테스트 2개 추가: 요약에서는 상세 표·담당자 의견이 반복되지 않으며 전체 인쇄 문서에는 유지되는지, 근거 단계에 실제 누락·변수 lineage가 포함되는지 검증했다.
- 브라우저에서 사례 검토와 직접 인터뷰 양쪽의 단계를 이동했다. 담당자 의견을 작성한 뒤 다른 단계로 이동해도 입력이 유지되고, 저장 전 다운로드가 비활성화됐다.
- 직접 인터뷰의 의견 revision 2 저장 후 실제 JSON 파일을 다운로드했다. 139,325 bytes, 100개 변수, 최신 의견, FINAL hash `sha256:d414afb5001e89ff8c069c01b8226d86757658cfae918da39104aab34ea03a91` 불변을 확인했다.
- 데스크톱 1360×940에서 사례 요약과 실제 인터뷰의 기관·자료 준비 화면을 확인했다. 모바일 390×844에서 5개 단계가 전부 보이고 문서 폭 375px로 가로 넘침이 없었다.
- 인쇄용 전체 문서·브라우저 인쇄 호출은 유지했다. 인앱 브라우저에서 네이티브 인쇄 창을 확인할 수 없어 최종 PDF 파일 렌더링은 검증하지 못했다. JSON은 실제 내려받은 파일로 확인했다.

## 배포

- 애플리케이션 커밋 **`7277f35`**, `feature/service-review-completion` push 완료.
- Cloud Build **`3bc1ec4d-2e7d-425d-905e-217fe519046a` SUCCESS**, 2026-09-06 22:25:21 KST 빌드 완료.
- 이미지 digest `sha256:0bfcd2125ad843ca6fa3e8d6b94334e47e72b55a2b01517b41f6dab53901b7c6`. 공개 심사 VM `donghaeng-review-app`에 적용했다. 시작 스크립트 exit 0, `donghaeng-review.service` active, 실행 이미지 일치를 확인했다.
- 기존 공유 주소·단계 직접 주소·최초/후속/미응답 사례와 홈·소개·결과·시연 총 **9개 공개 경로 HTTP 200**. 검토자료 경로의 상위 단계 5개와 요약 영역, 불필요한 로그인 홍보 문구 없음을 확인했다.
- 공개 10개 사례의 94개 변수·평가·상태·근거를 로컬과 대조했다. 점수와 반영 분모, 원문은 정확히 일치했다. 변수·lineage의 Linux/Windows 수치 말단 차이만 절대 `1e-9` + 상대 `1e-12` 허용오차로 비교했다. 최대 절대 차이는 `1.862645149230957e-9`다.
- 배포 후 **공개 인터뷰 API 31개 검사 통과**. 실제 Anthropic 답변 3개 모두 `APPLIED/tool_use`. 23,000,000원 → Canonical → Feature, 근거 추적, MISSING, FINAL 불변, 실행 기록, 상담 준비 저장, 방문자 격리를 확인했다.
- 공개 화면에서 9월 5일에 저장했던 담당자 의견과 목표·수행자료 확인 상태를 그대로 읽었다. 새로 받은 94개 변수 JSON(105,640 bytes)의 평가·원문·담당자 의견이 배포 전 파일과 일치했다.
- 배포 전 직접 인터뷰에서 새로 받은 100개 변수 JSON(142,506 bytes)의 전체 review·Recovery·상담 초안·기관 정보가 이전 파일과 일치했다. 13개 COMPUTED·87개 MISSING, 실행 기록 3개 ID, 검토 의견, 기관 선택, 일부 준비자료, FINAL hash를 보존했다.
- 공개 `/consultation/:id`가 같은 화면의 **자료 내보내기** 단계에서 열리고 저장한 지역신용보증재단·매출/비용 준비 상태가 표시됐다.
- 공개 모바일 390×844에서 5개 단계가 두 줄로 모두 보였다. 문서 폭과 본문 폭 375px, 가로 넘침 없음, 표시 패널 1개, 오류 메시지 없음을 확인했다. 브라우저 화면 크기를 복원했다.

공개 주소: [금융기관 검토자료](https://donghaeng-finance-review-jy5k5cvnjq-du.a.run.app/demo/admin), [기존 공유 주소](https://donghaeng-finance-review-jy5k5cvnjq-du.a.run.app/modeling?case=case_operating_drop&review=final).

실행 증적: [공개 경로·10개 사례 대조](verification/institution-workspace-public-2026-09-06.json), [공개 인터뷰 API](verification/institution-workspace-engine-public-2026-09-06.json), [다운로드·기록 보존·모바일·상담 준비 연결](verification/institution-workspace-browser-2026-09-06.json).

## 현재 범위

Competition Demo / Synthetic Data. 금융기관 검토용 자료를 만들고 공식 상담 안내로 연결한다. 기관 자동 전송·상담 접수, 실제 금융기관 데이터 연동, 학습된 신용모델, 대출 판단, 자동 신용 재평가, 증빙 진위 확인은 구현하지 않았다. 이번 변경은 자료를 확인하고 준비하는 흐름을 개선하며 서버의 수치·상태·원문을 바꾸지 않는다.
