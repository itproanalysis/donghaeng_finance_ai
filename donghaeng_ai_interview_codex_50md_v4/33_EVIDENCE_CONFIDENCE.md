# 33. 근거·확인수준·신뢰도

## 목적
피쳐마다 자기진술/자료/거래/충돌 상태를 보존한다.

## 핵심 개발 지시
- SELF_REPORTED
- DOCUMENT_SUPPORTED
- TRANSACTION_SUPPORTED
- SYSTEM_DERIVED
- CONFLICTING/UNKNOWN
- extraction_confidence와 verification 분리

## 구현 메모
상세보기에서 근거와 기준시점을 확인할 수 있어야 한다.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
