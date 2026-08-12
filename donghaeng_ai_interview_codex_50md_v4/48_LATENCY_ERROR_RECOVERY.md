# 48. 지연시간·오류복구·Fallback

## 목적
실시간 인터뷰가 끊기지 않도록 장애대응을 설계한다.

## 핵심 개발 지시
- partial STT 체감 0.5~1s
- final 1.5s 내 목표
- 패널 update 1~2s
- 다음 질문 2~4s
- mic→text fallback
- STT/LLM/SSE failure recovery

## 구현 메모
네트워크 단절/재연결 E2E를 포함한다.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
