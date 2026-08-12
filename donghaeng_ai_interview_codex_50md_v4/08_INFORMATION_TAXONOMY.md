# 08. 인터뷰 정보 Taxonomy

## 목적
필요정보를 4대 평가축과 세부영역으로 분류한다.

## 핵심 개발 지시
- CURRENT_STATE: 매출·비용·현금흐름·고객·충격
- IMPROVEMENT_INTENT: 문제인식·자기계획·실행준비
- FUTURE_OUTLOOK: 예약·수주·반복수요·계절성
- HOUSEHOLD_STATE: 비사업소득·필수지출·비상버퍼·자금분리

## 구현 메모
모든 info_code는 primary category를 하나 가진다.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
