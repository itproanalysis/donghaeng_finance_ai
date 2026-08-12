# 19. 다음 질문 선택 Algorithm

## 목적
필요정보를 놓치지 않으면서 자연스러운 질문 순서를 만든다.

## 핵심 개발 지시
- priority_weight
- missing_criticality
- dependency_readiness
- topic_continuity
- repetition/user burden penalty

## 구현 메모
한 번에 질문 하나, 이미 답한 내용 반복 금지.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
