# 12. 브라우저 Audio Capture

## 목적
사용자 음성을 안정적으로 chunking해 서버에 전달한다.

## 핵심 개발 지시
- getUserMedia echoCancellation/noiseSuppression/autoGainControl
- MVP는 MediaRecorder 250~500ms chunk 권장
- audio/webm;codecs=opus 지원 확인
- sequence/client_time/mime_type metadata
- track stop과 memory leak 방지

## 구현 메모
30분 인터뷰에서도 안정적으로 동작해야 한다.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
