# 41. 4대 평가축 등급과 종합지표

## 목적
인터뷰 기반 보조등급을 구성한다.

## 핵심 개발 지시
- Current State
- Improvement Intent
- Future Outlook
- Household State
- score/grade/summary/coverage/quality
- 초기 A~E threshold config

## 구현 메모
공식 신용등급과 혼동되는 표현을 금지한다.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
