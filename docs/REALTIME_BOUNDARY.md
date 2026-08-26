# 실시간·음성 연동 경계

텍스트, OpenAI Realtime WebRTC, 로컬 STT 음성은 모두 **FINAL TranscriptSegment 이후** 같은 message command와 결정론적 domain pipeline에 합류합니다. STT partial과 raw audio, Realtime assistant 발화는 권위 데이터가 아닙니다. 질문 선택·정보 추출·상태전이·평가의 권위는 계속 서버에 있습니다.

## 통화형 Realtime 우선 경로

음성 인터뷰 시작 시 브라우저는 동일 출처 `POST /api/interviews/{id}/realtime-session`에 단기 자격증명을 요청합니다. 이 route는 세션 인증, tenant-scoped 인터뷰 접근, `MICROPHONE_INTERVIEW`와 `CLOUD_AI_PROCESSING` 동의를 다시 검사하고 사용자·인터뷰별 분당 6회 제한을 적용합니다. 장기 `OPENAI_API_KEY`는 서버 밖으로 나가지 않습니다.

브라우저는 반환된 단기 secret으로 OpenAI `/v1/realtime/calls`에 SDP를 보내 WebRTC peer connection을 만듭니다. 입력에는 echo cancellation·noise suppression·automatic gain control, 한국어 `gpt-transcribe`, semantic VAD와 interruption을 사용하고 출력은 고정 `gpt-realtime-2.1`·`marin` 음성입니다. 원격 오디오 track은 사용자 시작 클릭에서 열린 `<audio autoplay>`로 즉시 재생됩니다.

Realtime 모델은 짧은 공감·확인 발화까지만 자유롭게 만들 수 있습니다. 다음 질문은 message command 반영 후 서버 snapshot의 canonical 질문을 `response.create` 제약으로 전달하며 모델이 새 질문·업종·금액을 지어내지 못하게 합니다. 완료된 사용자 전사는 item ID 기반으로 한 번만 기존 message command에 제출되고, 서버 처리 중에는 마이크 track을 잠가 중복 턴을 막습니다.

세션 발급, WebRTC 협상 또는 공급자 오류가 나면 같은 화면에서 로컬 faster-whisper/Qwen 경로로 자동 전환합니다. fallback 역시 transcript를 기존 message command에 저장하므로 업무 결과는 동일합니다.

## 두 개의 독립 순서 공간

| 채널 | 목적 | 순서·복구 권위 |
|---|---|---|
| SSE `/api/interviews/{id}/events` | 정보·coverage·feature·summary·질문·완료 업무상태 | interview별 durable `seq`, aggregate version, batch, snapshot resync |
| WebRTC OpenAI Realtime | 통화형 마이크·AI 음성·실시간 자막·VAD | 일시적 Realtime item/event ID; 완료 전사를 message command로 제출할 때만 업무상태가 됨 |
| WS `/ws/interviews/{id}/audio` | 오디오 control/chunk와 STT/VAD UI event | audio session별 `audioSeq`, ACK, bounded in-memory replay |

`audioSeq`, Realtime event/item ID와 SSE `seq`를 서로 비교하거나 한 채널의 완료 신호를 다른 채널의 commit으로 취급하면 안 됩니다. 음성의 완료 전사가 message API transaction에 저장된 뒤에야 업무 outbox event가 생성됩니다.

## 브라우저 capture

Realtime WebRTC와 fallback `useAudioInterview`는 다음 제약으로 `getUserMedia`를 호출합니다.

- `echoCancellation`, `noiseSuppression`, `autoGainControl`: true
- Realtime은 browser WebRTC 오디오 track을 직접 전송
- fallback은 mono channel과 `MediaRecorder.isTypeSupported()` 협상 후 400ms chunk 전송
- fallback은 AudioContext analyser 기반 level meter 사용

마이크 버튼은 먼저 `MICROPHONE_INTERVIEW`의 유효한 versioned 동의를 조회합니다. Realtime을 선택한 경우 외부 실시간 음성·전사 처리를 위한 `CLOUD_AI_PROCESSING` 동의도 필요합니다. 동의가 없으면 처리 목적, provider 경계, raw audio 미저장을 설명하고 grant/deny 결정을 append합니다. grant 이후에만 브라우저 권한과 capture를 시작하며 Realtime 세션 발급 route와 fallback WebSocket도 동의를 다시 확인합니다.

마이크 시작은 WebSocket 연결과 `audio.start` ACK가 끝난 뒤 recorder를 시작합니다. 종료는 recorder의 마지막 `dataavailable` 처리, 모든 pending frame send, 마지막 audio ACK를 기다린 뒤 `audio.end_turn`을 전송합니다. 이 순서가 final transcript보다 마지막 오디오가 늦게 도착하는 경쟁조건을 막습니다.

마이크 권한 거절, 장치 없음/점유, MIME 미지원, 연결 실패는 화면에 오류를 표시하되 텍스트 입력을 막지 않습니다. tab이 숨겨지거나 component가 unmount되면 recorder, 모든 MediaStreamTrack, AudioContext, WebSocket을 정리합니다.

## Audio protocol dev-v1

control message는 JSON이며 공통 필드는 다음과 같습니다.

```json
{
  "protocolVersion": "dev-v1",
  "type": "audio.start",
  "correlationId": "uuid",
  "audioSessionId": "uuid",
  "interviewId": "uuid",
  "mimeType": "audio/webm;codecs=opus",
  "lastAckedAudioSeq": 0
}
```

control type은 `audio.start`, `audio.pause`, `audio.resume`, `audio.end_turn`, `audio.stop`입니다. binary frame layout은 다음과 같습니다.

```text
[4-byte big-endian JSON header length]
[UTF-8 JSON AudioChunkHeader]
[encoded audio bytes]
```

header에는 `protocolVersion`, `type=audio.chunk`, `audioSessionId`, 1부터 증가하는 `audioSeq`, `clientMonotonicMs`, `mimeType`이 필요합니다. server message는 `audio.ack`, `vad.speech_started/stopped`, `stt.partial/final`, `audio.error`입니다. 정확한 schema는 `contracts/asyncapi.json`을 권위로 사용합니다.

Server는 중복 이하 sequence에 현재 ACK를 다시 보내고, 다음 값보다 큰 sequence에는 비복구 `AUDIO_SEQUENCE_GAP`을 반환합니다. 연결별 message 처리는 Promise chain으로 직렬화됩니다.

## Backpressure와 재연결

- WebSocket `bufferedAmount`가 1,000,000 bytes를 넘으면 recorder와 STT session에 pause를 보내고, 250,000 bytes 아래로 내려가면 resume합니다.
- client는 ACK되지 않은 최대 40개 frame만 메모리에 보존합니다.
- 의도하지 않은 close에서 recorder를 pause하고 최대 3회 지수 backoff로 같은 `audioSessionId`를 resume합니다.
- server는 같은 interview와 session cookie digest만 session을 이어 받을 수 있게 하고 기존 socket을 닫습니다.
- server memory retention은 미확정 session 30초, final 생성 session 120초입니다. 전역·principal별 상한, 동시 start 예약과 무오디오 close 즉시 정리로 빈 session churn이 정상 사용자의 STT slot을 고갈시키지 못하게 합니다.

이 resume는 process-local입니다. 서버 재시작, 배포, load balancer가 다른 인스턴스로 보낸 연결에서는 복구되지 않습니다. 운영에서는 외부 session state 또는 sticky routing과 명확한 text fallback 정책이 필요합니다.

## STT provider 경계

`StreamingSttAdapter`는 개발용 mock과 production-capable OpenAI-compatible multipart adapter를 같은 session interface로 분리합니다.

- `npm run dev`의 기본 `mock`은 audio bytes를 해석하지 않고 현재 질문별 합성 transcript를 반환하며 label에 이 사실을 남깁니다.
- production은 `mock` 또는 provider 미설정을 startup에서 거부하고 `DONGHAENG_STT_PROVIDER=openai-compatible`, HTTPS endpoint와 key를 요구합니다.
- 실제 adapter는 MIME allow-list, 고정 안전 파일명, 최대 buffer/chunk, response 크기, redirect 금지, timeout/abort와 strict JSON/text 검증을 적용합니다.
- `end_turn`에서 합친 in-memory audio를 multipart로 전사하며 provider label/model을 transcript metadata와 WS event에 보존합니다.
- raw audio는 요청을 마치면 폐기하며 DB/파일에 저장하지 않습니다.

production E2E는 bounded local multipart stub으로 adapter/network/metadata를 검증합니다. 다만 실제 한국어 인식률·공급자 latency·장시간 품질은 승인된 자격증명과 녹음 fixture가 있어야 하므로 운영 gate로 남습니다. 숫자 parser 정확도는 저장된 transcript에 대한 domain test가 별도로 검증합니다.

## partial, final, correction

- `stt.partial`: UI 자막 전용. DB, parser, feature의 입력이 아닙니다.
- `stt.final`: stable `audio-{audioSessionId}-final` idempotency key로 message API에 저장한 뒤 client에 알립니다.
- 저장 transcript: `confirmation=FINAL`; `rawText`, effective `text`, optional corrected text, start/end/confidence/provider, revision을 분리합니다.
- correction: ACTIVE 인터뷰의 FINAL segment만 허용하며 원본 raw text를 바꾸지 않고 effective text와 revision/correction history를 append합니다.

현재 route는 `TranscriptCorrectionService`에 `InterviewService.reprocessTranscriptCorrection` 동기 hook을 주입합니다. corrected effective text에서 새 evidence와 superseding selected canonical revision을 만들고 legacy 값/상태, coverage, live feature, summary, audit를 갱신한 뒤 `transcript.corrected`와 재파생 event를 한 outbox batch에 append합니다. hook 실패 시 SAVEPOINT/outer transaction이 transcript, revision, evidence, projection, version과 outbox를 모두 rollback합니다.

## VAD와 수동 종료

Realtime 우선 경로는 OpenAI semantic VAD가 말 시작·종료, 자동 response 생성과 끼어들기를 처리합니다. fallback 자동 종료는 client level meter의 단순 threshold이며, 사용자가 옵션을 켠 경우 음성이 한 번 감지된 뒤 level이 0.08 미만으로 1초 유지되면 `endTurn`을 호출합니다. fallback 기본값은 off이고 **답변 끝내기** 버튼이 항상 권위 경로입니다.

Mock adapter도 speech started/stopped event를 보내지만 실제 acoustic VAD 결과가 아닙니다. provider endpointing 또는 검증된 server VAD를 붙이기 전에는 생각 중 침묵, 소음, 장치 gain에 대한 정확성을 주장할 수 없습니다.

## 질문 음성 출력

질문 text는 항상 표시합니다. Realtime 우선 경로는 원격 WebRTC audio track의 `marin` 음성을 재생하고, 다시 듣기는 같은 canonical 질문으로 새 `response.create`를 보냅니다. fallback은 Qwen3-TTS Sohee 오디오를 사용하고, 실패할 때만 browser `speechSynthesis`의 `ko-KR` utterance를 최종 보조로 사용합니다. 어떤 TTS 오류도 text 인터뷰나 저장된 질문을 바꾸지 않습니다.

## SSE event와 replay

현재 durable event type은 다음 12개입니다.

- `transcript.finalized`
- `info.status_changed`, `info.value_changed`
- `coverage.changed`
- `feature.preview_updated`, `summary.preview_updated`
- `question.generated`, `conflict.detected`, `ready_to_complete`
- `transcript.corrected`
- `evaluation.ready`
- `interview.completed`

각 envelope는 `schemaVersion=1`, `eventId`, numeric `seq`, `aggregateVersion`, `snapshotType`, `occurredAt`, `turnId`, `batchIndex`, `batchSize`, `isBatchFinal`, `snapshotUrl`, `type`, `data`를 포함합니다. SSE `id`는 numeric `seq`입니다.

재접속 cursor는 `Last-Event-ID` 또는 `?after=`로 전달합니다. 둘 다 보내고 값이 다르면 400입니다. server는 cursor보다 큰 event를 최대 500개씩 순서대로 읽고 750ms polling, 15초 heartbeat, `retry: 3000`을 사용합니다. outbox의 기본 replay 만료시각은 생성 후 7일입니다.

cursor가 보존 window보다 오래되면 server는 409 `EVENT_REPLAY_GAP`과 `snapshotUrl`을 반환합니다. client는 duplicate를 무시하고 sequence/version gap 또는 반복 연결 실패에서 authoritative snapshot을 다시 읽습니다. event는 변화 신호이며, multi-projection batch의 일부를 직접 최종 상태로 확정하지 않습니다.

`transcript.finalized`는 FINAL transcript가 영속화됐고 turn 처리 결과가 `APPLIED`, 수동 재처리 가능한 `RETRYABLE_FAILURE`, 또는 terminal receipt가 저장된 `NON_RETRYABLE_FAILURE`인지 알립니다. retryable stage는 tenant-scoped PREVIEW의 allow-listed `pendingCommand`로 다시 읽을 수 있어 reload 뒤에도 같은 ID/text/version/question/STT metadata를 복원합니다. request hash, DB lease token, credential, prompt, provider body/raw error는 event와 snapshot에 포함하지 않습니다. strict COMPLETE에서 평가가 READY로 저장되면 같은 FINAL batch에 `evaluation.ready`가 `interview.completed`보다 먼저 기록됩니다. payload에는 `evaluationId`, `finalSnapshotId`, `snapshotVersion`, 고정된 `decisionScope=INTERVIEW_DATA_QUALITY_ONLY`가 들어갑니다. 이 event는 평가 내용을 운반하거나 신용·승인 결과를 뜻하지 않으며, client는 batch 종료 뒤 tenant-scoped 평가 API를 다시 읽습니다. FORCE_INCOMPLETE 또는 READY가 아닌 평가에는 `evaluation.ready`가 없습니다.

새 event type을 server enum/DB CHECK/OpenAPI/AsyncAPI에 추가할 때는 frontend named listener와 live-store union도 같은 변경에서 갱신해야 합니다. 현재 12개 type에 `transcript.finalized`, `transcript.corrected`, `evaluation.ready`가 모두 동기화되어 있으며 contract/E2E에서 이 상태를 계속 확인합니다. migration 010은 기존 outbox row를 보존하면서 DB CHECK에 `evaluation.ready`를 추가합니다.

## WS 보안과 한계

현재 custom server는 다음을 적용합니다.

- session cookie 인증 후 upgrade
- 해당 사용자/interview의 유효한 `MICROPHONE_INTERVIEW` consent 재검사
- production에서 Origin 필수, exact `DONGHAENG_APP_ORIGIN` 일치
- client(remote address + cookie digest)당 4개, 전체 200개 audio connection
- connection당 분당 400 message, 60초 idle timeout
- frame max payload 2 MiB, per-message deflate off
- malformed path/URI/control/header 거부

개발 환경에서는 Origin이 없는 비브라우저 client를 허용하지만 Origin이 있으면 exact match를 검사합니다. 운영 WSS는 custom server 앞의 승인된 TLS proxy가 제공해야 하며 이 process 자체는 인증서/TLS를 관리하지 않습니다. 상한과 rate state도 process-local이라 분산 방어가 아닙니다.

## Raw audio 보존

현재 DB migration과 server에는 raw audio를 저장하는 table, object storage writer, 파일 writer가 없습니다. Realtime raw audio는 동의 후 브라우저에서 OpenAI로 직접 전송되며 앱 서버를 통과하지 않습니다. fallback audio bytes는 browser replay buffer와 server/STT session 메모리에서만 처리하고 stop/timeout/cleanup 때 폐기합니다.

향후 저장 요구가 생겨도 기본 off를 유지하고, 별도 목적 동의·opt-in·암호화·짧은 TTL·접근감사·삭제 검증 전에는 구현하지 않습니다.
