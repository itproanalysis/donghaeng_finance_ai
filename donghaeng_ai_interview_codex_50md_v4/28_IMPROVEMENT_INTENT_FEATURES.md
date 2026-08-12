# 28. 개선의지 정량 Feature

## 목적
말투나 감정 대신 계획의 구체성과 실행준비를 수치화한다.

## 핵심 개발 지시
- problem_specificity
- self_plan_exists
- plan_action_count/plan_specificity
- plan_time_bound/plan_measurability
- execution_readiness/past_execution_examples
- obstacle_awareness/evidence_readiness

## 구현 메모
sentiment·목소리 자신감·표정은 피쳐로 금지한다.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
