export const OPENAI_REALTIME_MODEL = "gpt-realtime-2.1";
export const OPENAI_REALTIME_TRANSCRIPTION_MODEL = "gpt-transcribe";
export const OPENAI_REALTIME_VOICE = "marin";

type UnknownRecord = Record<string, unknown>;

export type ParsedRealtimeVoiceEvent =
  | { type: "SESSION_READY" }
  | { type: "SPEECH_STARTED" }
  | { type: "SPEECH_STOPPED" }
  | { type: "INPUT_TRANSCRIPT_DELTA"; delta: string; itemId: string | null }
  | { type: "INPUT_TRANSCRIPT_DONE"; transcript: string; itemId: string | null }
  | { type: "ASSISTANT_TRANSCRIPT_DELTA"; delta: string }
  | { type: "ASSISTANT_TRANSCRIPT_DONE"; transcript: string }
  | { type: "RESPONSE_STARTED" }
  | { type: "RESPONSE_AUDIO_DONE" }
  | { type: "RESPONSE_DONE" }
  | { type: "ERROR"; message: string }
  | { type: "IGNORED" };

export interface RealtimeClientSecretView {
  value: string;
  expiresAt: number | null;
  model: string;
  voice: string;
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonEmptyDelta(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function eventItemId(event: UnknownRecord): string | null {
  return nonEmptyString(event.item_id) ?? nonEmptyString(event.itemId);
}

function transcriptFromConversationItem(value: unknown): string | null {
  if (!isRecord(value) || value.role !== "user" || !Array.isArray(value.content)) {
    return null;
  }
  for (const part of value.content) {
    if (!isRecord(part)) continue;
    const transcript = nonEmptyString(part.transcript);
    if (transcript) return transcript;
  }
  return null;
}

export function parseRealtimeClientSecret(value: unknown): RealtimeClientSecretView | null {
  if (!isRecord(value)) return null;
  const secret = nonEmptyString(value.value);
  const model = nonEmptyString(value.model);
  const voice = nonEmptyString(value.voice);
  const expiresAt = value.expiresAt;
  if (
    !secret ||
    secret.length > 2_048 ||
    !model ||
    model.length > 128 ||
    !voice ||
    voice.length > 64 ||
    (expiresAt !== null &&
      (typeof expiresAt !== "number" || !Number.isFinite(expiresAt) || expiresAt <= 0))
  ) {
    return null;
  }
  return { value: secret, expiresAt, model, voice };
}

export function parseRealtimeVoiceEvent(raw: string): ParsedRealtimeVoiceEvent {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { type: "IGNORED" };
  }
  if (!isRecord(value)) return { type: "IGNORED" };
  const eventType = nonEmptyString(value.type);
  if (!eventType) return { type: "IGNORED" };

  if (eventType === "session.created" || eventType === "session.updated") {
    return { type: "SESSION_READY" };
  }
  if (eventType === "input_audio_buffer.speech_started") {
    return { type: "SPEECH_STARTED" };
  }
  if (eventType === "input_audio_buffer.speech_stopped") {
    return { type: "SPEECH_STOPPED" };
  }
  if (eventType === "conversation.item.input_audio_transcription.delta") {
    const delta = nonEmptyDelta(value.delta);
    return delta
      ? { type: "INPUT_TRANSCRIPT_DELTA", delta, itemId: eventItemId(value) }
      : { type: "IGNORED" };
  }
  if (eventType === "conversation.item.input_audio_transcription.completed") {
    const transcript = nonEmptyString(value.transcript);
    return transcript
      ? { type: "INPUT_TRANSCRIPT_DONE", transcript, itemId: eventItemId(value) }
      : { type: "IGNORED" };
  }
  // Newer Realtime event versions can attach a completed input transcript to
  // the finished conversation item instead of emitting the legacy dedicated
  // transcription event. Supporting both keeps the browser client compatible
  // without ever deriving a transcript from model output.
  if (eventType === "conversation.item.done") {
    const transcript = transcriptFromConversationItem(value.item);
    const item = isRecord(value.item) ? value.item : null;
    return transcript
      ? {
          type: "INPUT_TRANSCRIPT_DONE",
          transcript,
          itemId: nonEmptyString(item?.id) ?? eventItemId(value),
        }
      : { type: "IGNORED" };
  }
  if (eventType === "response.output_audio_transcript.delta") {
    const delta = nonEmptyDelta(value.delta);
    return delta
      ? { type: "ASSISTANT_TRANSCRIPT_DELTA", delta }
      : { type: "IGNORED" };
  }
  if (eventType === "response.output_audio_transcript.done") {
    const transcript = nonEmptyString(value.transcript);
    return transcript
      ? { type: "ASSISTANT_TRANSCRIPT_DONE", transcript }
      : { type: "IGNORED" };
  }
  if (eventType === "response.created") return { type: "RESPONSE_STARTED" };
  if (eventType === "response.output_audio.done") return { type: "RESPONSE_AUDIO_DONE" };
  if (eventType === "response.done") return { type: "RESPONSE_DONE" };
  if (eventType === "error") {
    const error = isRecord(value.error) ? value.error : null;
    return {
      type: "ERROR",
      message:
        nonEmptyString(error?.message) ??
        "실시간 음성 연결에서 오류가 발생했습니다.",
    };
  }
  return { type: "IGNORED" };
}

export function canonicalQuestionResponseEvent(
  question: string,
  questionKey: string,
  includeWelcome: boolean,
): UnknownRecord {
  const welcome = includeWelcome
    ? "먼저 ‘안녕하세요, 사장님. 정답을 찾는 자리가 아니라 사장님 사업 이야기를 편하게 듣는 시간이에요.’라고 자연스럽게 인사한 뒤 "
    : "";
  return {
    type: "response.create",
    response: {
      output_modalities: ["audio"],
      max_output_tokens: 220,
      metadata: {
        kind: "canonical_interview_question",
        question_key: questionKey.slice(0, 128),
      },
      instructions: [
        "한국어로 따뜻하고 자연스럽게 말하세요.",
        "설명, 해석, 새로운 질문, 예시 답변을 덧붙이지 마세요.",
        `${welcome}아래 질문 문장을 의미가 달라지지 않게 한 번만 말하세요.`,
        `질문: ${question}`,
      ].join("\n"),
    },
  };
}

export function realtimeSessionInstructions(): string {
  return [
    "당신은 동행금융AI의 한국어 음성 인터뷰 진행자입니다.",
    "사장님의 말을 끊지 말고, 차분하고 따뜻하며 짧게 말하세요.",
    "사업 정보나 숫자를 추측하거나 만들어 내지 마세요.",
    "사용자의 발화가 끝나면 질문 없이 10단어 이내의 자연스러운 확인 문장만 말하세요.",
    "‘모르겠다’, ‘답하기 싫다’, ‘없다’는 답변을 설득하거나 반복 확인하지 마세요.",
    "다음 공식 질문은 애플리케이션이 별도로 전달합니다. 스스로 다음 질문을 만들지 마세요.",
    "애플리케이션이 공식 질문을 전달하면 그 질문만 한 번 말하고 답변을 기다리세요.",
  ].join("\n");
}
