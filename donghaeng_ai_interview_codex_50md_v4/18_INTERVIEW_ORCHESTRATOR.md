# 18. AI Interview Orchestrator

## 목적
확정 transcript와 필요정보 상태를 결합해 추출·질문·요약 갱신을 수행한다.

## 핵심 개발 지시
- 입력: required items/existing data/transcript/context
- 출력: extracted info/state changes/next question/live summary delta/feature delta
- LLM structured output
- 서버에서 상태전이 validation
- LLM 실패 시 transcript 보존

## 구현 메모
LLM JSON 오류가 업무상태를 깨뜨리지 않아야 한다.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
