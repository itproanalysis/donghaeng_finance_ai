# 16. 실시간 자막과 확정 Transcript

## 목적
partial과 final을 구분하고 수정 이력까지 보존한다.

## 핵심 개발 지시
- partial은 UI 전용
- final은 TranscriptSegment 저장
- speaker/start_ms/end_ms/confidence
- 사용자 수정 시 raw와 corrected 둘 다 보존
- 정보추출은 corrected 우선

## 구현 메모
final transcript 이후에만 정보추출을 시작한다.


## 공통 구현 원칙
- 프론트가 임의로 평가값을 만들지 않는다. 서버 이벤트/스냅샷을 source of truth로 사용한다.
- 인터뷰 중 값은 `PREVIEW`, 종료 후 값은 `FINAL`로 명시한다.
- `missing`, `unknown`, `refused`, `not_applicable`, 실제 0을 구분한다.
- 대출 승인 여부는 이 모듈에서 결정하지 않는다.


## Codex 완료 조건
- 이 파일의 기능을 실제 코드/스키마/UI 중 해당 위치에 반영한다.
- 최소 1개의 정상 케이스와 1개의 오류/경계 케이스 테스트를 추가한다.
- 구현 결과가 다음 파일의 입력으로 연결되는지 확인한 뒤 다음 단계로 진행한다.
