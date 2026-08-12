# 49. 테스트 전략과 SOHO 데모 시나리오

## 목적
다양한 SOHO 상황에서 정보수집·음성·평가를 검증한다.

## 핵심 개발 지시
- 음식점/카페/온라인/미용/학원/숙박
- 인테리어/정비/소매/운송/도매/신규사업
- 각 fixture에 required list/transcript/state transitions/features/goals/evaluation
- 브라우저 자동화에서는 mock MediaStream/STT
- 수동 데모는 실제 마이크

## 구현 메모
모호/충돌/거절/한 답변 다중수집 케이스를 반드시 포함한다.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
