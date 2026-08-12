# 50. Codex 실행순서와 최종 Definition of Done

## 목적
49개 지시안을 실제 개발 작업순서로 연결한다.

## 핵심 개발 지시
- 1 Domain/DB
- 2 Required info/state
- 3 text interview
- 4 mic+WS
- 5 streaming STT
- 6 orchestrator
- 7 SSE/live panel
- 8 live feature/summary
- 9 snapshot
- 10 evaluation UI
- 11 goals/detail
- 12 E2E

## 구현 메모
최종 데모는 마이크 답변→자막→정보카드 이동→피쳐/요약 변경→후속질문→종료→평가·목표·상세근거까지 한 번에 보여야 한다.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
