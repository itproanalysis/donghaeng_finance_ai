# 금융기관 검토자료 페이지 복원 · 2026-09-06

기존 금융기관 검토 페이지 `/demo/admin`이 상담 목록으로 리다이렉트되고, 기존 공유 주소의 `review=final`이 무시되어 검토서에 바로 접근할 수 없었다. 원래의 검토자료 화면을 복원하고, 사업 현황·평가 산출 근거·수행자료·담당자 의견을 담는 최종 검토서로 연결했다.

## 화면과 기존 기능 재사용

- `/demo/admin`: `AdminDemo`를 다시 사용한다. 기존의 고정 예시 금액과 ‘상환 안정성 양호’, ‘증빙 완비’ 표시는 제거했다. `getModelingCase`와 `getModelingBundle`의 실제 합성 사례 산출물을 `ModelingWorkflow`로 전달한다.
- `ModelingInstitutionReport`: 사업 현황·현금흐름·자료 구성의 세 부분에 이어 평가항목 10개의 배점·분모·변수 lineage, 인터뷰 원문, 목표·예산·제약, 후속 월별 거래자료, 누락과 담당자 의견을 한 문서에 표시한다. 브라우저에서는 값을 다시 계산하지 않는다.
- `/modeling?case=case_operating_drop&review=final`: 기존 주소 그대로 검토서 탭을 연다. 명시적인 `tab` 값이 있으면 해당 탭을 우선한다. 기존 브라우저 검토 기록 키를 유지해 이전 의견·확인 상태를 보존한다.
- 최초 사례와 6개월 후 사례를 검토실에서 오간다. 최초 개선가능성은 54/80, 후속은 60/60으로 반영 항목이 다르다는 설명을 유지한다. 후속 원문이 없으면 과거 인터뷰로 채우지 않는다.
- `/demo/admin?interview=:id`: 직접 진행한 인터뷰의 기존 `/consultation-package`를 `InstitutionConsultation`의 검토자료 화면으로 연다. FINAL의 Canonical·100개 변수·원문, Recovery 실행 기록, 기관·자료 선택을 표시한다.
- 담당자 의견은 기존 `POST /api/interviews/:id/recovery`의 `REVIEW` 명령을 재사용한다. 저장된 서버 응답으로 미리보기를 갱신하고, 내보내기 직전에 패키지를 다시 읽는다. 저장하지 않은 의견이 있으면 다운로드와 인쇄를 막아 이전 의견으로 자료가 만들어지는 것을 방지한다.
- 기존 94개 합성 규칙 모형의 의견은 기존 브라우저 저장 방식, 직접 진행한 인터뷰의 의견은 서버의 append-only 검토 기록을 유지한다. 94개와 100개 변수 계약은 합치지 않는다.
- 첫 화면·메뉴·서비스 소개·분석 결과·종료 화면·운영자 목록·실행 기록에서 복원한 검토자료 페이지를 열 수 있다. `/consultation/:id`의 상담 준비 기능도 유지한다.

## 검토자료 만들기

1. **기관 검토자료**에서 기존 합성 거래자료 사례를 고르거나, **결과·상담 준비**에서 직접 진행한 인터뷰 기록을 선택한다.
2. 사업 현황, 원문, 변수와 평가 산출 근거, 부족한 정보, 수행자료를 확인한다.
3. 담당자가 검토 의견을 작성하고 저장한다.
4. **최종 검토자료 받기**로 JSON을 받거나 **검토자료 인쇄·PDF**를 사용한다. 상담 경로는 기관의 공식 안내에서 확인한다.

모든 미션이나 준비서류를 완료해야 검토서를 만들 수 있는 것은 아니다. 미확인 정보와 준비되지 않은 자료를 그대로 포함한다. 기관 전송·대출 신청을 자동으로 처리하지 않는다.

## 실제 실행한 검증

- `npm run typecheck`, `npm run lint`: 통과.
- `npm test`: 110개 파일, 776개 테스트 통과.
- `npm run build`: 복원한 `/demo/admin`과 기존 모델링·인터뷰·상담 API를 포함한 production 빌드 성공.
- `npm run test:e2e`: 통과. `/demo/admin`과 기존 `review=final` 주소가 리다이렉트 없이 200과 실제 검토서 HTML을 반환하는 검사를 추가했다. 94개 변수 경계, 인터뷰 데이터 생성 28개 검사, 인증·격리·CSRF·SSE·음성·정정·FINAL·초안 저장/재시작/충돌 검사를 유지했다.
- 신규 보고서 테스트 3개: 실제 합성 사례 금액·산식·근거 일치, 누락·원문 없음·후속 반영 분모, 담당자 입력 escaping과 평가값 불변.
- 브라우저에서 최초 검토자료의 메모와 ‘자료 보완 필요’를 저장했다. JSON 파일(105,607 bytes)에서 94개 변수·의견·원문·54/80 산식을 확인했다. 예전 `review=final` 주소에서도 동일한 저장 의견이 보였다.
- 6개월 후 검토자료에서 6개월 월별 수행자료, 새 인터뷰 없음, 38개 MISSING과 60/60 산식을 확인했다. 모바일 390×844에서 문서 폭 375px로 페이지의 가로 넘침이 없고 메뉴 4개가 모두 보였다.
- 직접 진행한 로컬 인터뷰에서 담당자 의견 입력 중 다운로드가 비활성화되고, 저장 후 미리보기와 다운로드에 최신 의견이 들어가는 것을 확인했다. 실제 JSON(139,341 bytes)에 100개 변수, 13개 COMPUTED·87개 MISSING, `NEEDS_INFORMATION` 의견 revision 1이 포함됐다. FINAL hash는 저장 전후 동일했다.
- 인쇄용 문서와 브라우저 인쇄 호출을 사용한다. 인앱 브라우저가 네이티브 인쇄 창을 제공하지 않아 최종 PDF 파일 렌더링은 확인하지 못했다. 실제 JSON 다운로드는 파일까지 확인했다.

## 범위

공개 서비스는 Competition Demo / Synthetic Data다. 거래자료 사례의 두 축 수치는 기존 고정 규칙 모형의 사업·행동 지표이며 학습된 신용모델이나 승인 확률이 아니다. 실제 인터뷰의 Signal을 별도 점수로 변환하지 않는다. 금융기관 데이터 연동, 대출 승인·거절, 자동 신용 재평가, 파일 증빙의 진위 검증, 기관 전송·상담 접수 기능은 없다.

## 배포

- 애플리케이션 커밋 `c440f0b`, `feature/service-review-completion` push 완료.
- Cloud Build `1b59de73-8770-4d1a-a949-85a9af2dfbed` SUCCESS. 2026-09-06 21:40:40 KST 빌드 완료.
- 이미지 digest `sha256:3b07dc06b8081b49eebadfc4f783491b7302751480d84f31d7e7a5ad9ab6b326`. 공개 심사 VM `donghaeng-review-app`의 시작 스크립트 exit 0, `donghaeng-review.service` active, 실행 이미지 일치.
- `/demo/admin`, 기존 `review=final` 주소, 후속·미응답 검토서, 첫 화면·소개·결과·사례 체험 총 8개 공개 경로가 HTTP 200과 기대 화면을 반환했다. 확인 경로에서 가입·구글 로그인 홍보 문구는 없었다.
- 공개 10개 사례의 94개 변수·상태·근거·원문·평가를 로컬 산출물과 대조했다. 점수와 반영 분모는 정확히 일치했다. Linux/Windows 수치 연산의 소수점 말단 차이만 최대 `1.862645149230957e-9` 있었으며, 변수·lineage 숫자는 절대 `1e-9` + 상대 `1e-12` 허용오차로 비교했다. 원문·상태·메타데이터는 정확히 비교했다. 서버 산출값은 변경하지 않았다.
- 배포 후 공개 인터뷰 API 31개 검사 통과. 합성 답변 3개 모두 실제 Anthropic `APPLIED/tool_use`. 원문→Canonical→Feature→Signal→실행 기록→검토 패키지, FINAL 불변, 방문자별 격리를 확인했다.
- 공개 검토실에서 9월 5일에 저장했던 검토 의견과 목표·수행자료 확인 상태가 유지됐다. 이 내용을 포함한 94개 변수 JSON(105,640 bytes)을 실제로 내려받았다.
- 배포 전 인터뷰의 원문, 13개 COMPUTED·87개 MISSING, 실행 기록 3개 ID, `REVIEWED` 상태, 선택 기관과 일부 준비자료, FINAL hash가 모두 유지됐다. 복원한 `/demo/admin?interview=:id`에서 JSON(142,506 bytes)을 내려받아 검증했다.
- 공개 인터뷰 검토서의 모바일 390×844, 페이지 폭 375px, 가로 넘침 없음과 오류 메시지 없음을 확인하고 브라우저 화면 크기를 복원했다.

공개 주소: [금융기관 검토자료](https://donghaeng-finance-review-jy5k5cvnjq-du.a.run.app/demo/admin), [기존 공유 주소](https://donghaeng-finance-review-jy5k5cvnjq-du.a.run.app/modeling?case=case_operating_drop&review=final).

실행 증적: [공개 경로·10개 사례 대조](verification/institution-review-public-2026-09-06.json), [공개 인터뷰 API 31개 검사](verification/institution-review-engine-public-2026-09-06.json), [다운로드·기록 보존·모바일](verification/institution-review-browser-2026-09-06.json). 이전 상담 준비 기능과 배포 이력은 [상담 연결 개선 기록](INSTITUTION_HANDOFF_2026-09-06.md)에 보존한다.
