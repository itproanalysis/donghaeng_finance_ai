const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const AUDIO_PROTOCOL_VERSION = "dev-v1" as const;

export const AUDIO_CONTROL_TYPES = [
  "audio.start",
  "audio.pause",
  "audio.resume",
  "audio.end_turn",
  "audio.stop",
] as const;

export type AudioControlType = (typeof AUDIO_CONTROL_TYPES)[number];

export interface AudioChunkHeader {
  protocolVersion: typeof AUDIO_PROTOCOL_VERSION;
  type: "audio.chunk";
  audioSessionId: string;
  audioSeq: number;
  clientMonotonicMs: number;
  mimeType: string;
}

export interface AudioControlMessage {
  protocolVersion: typeof AUDIO_PROTOCOL_VERSION;
  type: AudioControlType;
  correlationId: string;
  audioSessionId: string;
  interviewId: string;
  mimeType?: string;
  lastAckedAudioSeq?: number;
}

export type AudioServerMessage =
  | {
      protocolVersion: typeof AUDIO_PROTOCOL_VERSION;
      type: "audio.ack";
      correlationId?: string;
      audioSessionId: string;
      lastAudioSeq: number;
    }
  | {
      protocolVersion: typeof AUDIO_PROTOCOL_VERSION;
      type: "vad.speech_started" | "vad.speech_stopped";
      audioSessionId: string;
      serverTime: string;
    }
  | {
      protocolVersion: typeof AUDIO_PROTOCOL_VERSION;
      type: "stt.partial" | "stt.final";
      audioSessionId: string;
      text: string;
      provider: string;
      serverTime: string;
    }
  | {
      protocolVersion: typeof AUDIO_PROTOCOL_VERSION;
      type: "audio.error";
      correlationId?: string;
      audioSessionId?: string;
      code: string;
      message: string;
      retryable: boolean;
    };

export interface DecodedAudioFrame {
  header: AudioChunkHeader;
  audio: Uint8Array;
}

export function encodeAudioFrame(
  header: AudioChunkHeader,
  audio: ArrayBuffer | Uint8Array,
): ArrayBuffer {
  assertAudioChunkHeader(header);
  const encodedHeader = textEncoder.encode(JSON.stringify(header));
  const audioBytes = audio instanceof Uint8Array ? audio : new Uint8Array(audio);
  const frame = new Uint8Array(4 + encodedHeader.length + audioBytes.length);
  new DataView(frame.buffer).setUint32(0, encodedHeader.length, false);
  frame.set(encodedHeader, 4);
  frame.set(audioBytes, 4 + encodedHeader.length);
  return frame.buffer;
}

export function decodeAudioFrame(frame: ArrayBuffer | Uint8Array): DecodedAudioFrame {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.byteLength < 5) throw new Error("AUDIO_FRAME_TOO_SHORT");
  const headerLength = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getUint32(0, false);
  if (headerLength <= 0 || 4 + headerLength >= bytes.byteLength) {
    throw new Error("AUDIO_FRAME_INVALID_HEADER_LENGTH");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textDecoder.decode(bytes.subarray(4, 4 + headerLength)));
  } catch {
    throw new Error("AUDIO_FRAME_INVALID_JSON");
  }
  assertAudioChunkHeader(parsed);
  return {
    header: parsed,
    audio: bytes.slice(4 + headerLength),
  };
}

export function assertAudioChunkHeader(value: unknown): asserts value is AudioChunkHeader {
  if (!value || typeof value !== "object") throw new Error("AUDIO_HEADER_INVALID");
  const header = value as Partial<AudioChunkHeader>;
  if (
    header.protocolVersion !== AUDIO_PROTOCOL_VERSION ||
    header.type !== "audio.chunk" ||
    typeof header.audioSessionId !== "string" ||
    header.audioSessionId.length === 0 ||
    !Number.isSafeInteger(header.audioSeq) ||
    (header.audioSeq ?? 0) <= 0 ||
    typeof header.clientMonotonicMs !== "number" ||
    !Number.isFinite(header.clientMonotonicMs) ||
    typeof header.mimeType !== "string" ||
    header.mimeType.length === 0
  ) {
    throw new Error("AUDIO_HEADER_INVALID");
  }
}

export function parseAudioServerMessage(raw: string): AudioServerMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("AUDIO_SERVER_MESSAGE_INVALID_JSON");
  }
  if (!value || typeof value !== "object") {
    throw new Error("AUDIO_SERVER_MESSAGE_INVALID");
  }
  const candidate = value as Partial<AudioServerMessage>;
  if (
    candidate.protocolVersion !== AUDIO_PROTOCOL_VERSION ||
    typeof candidate.type !== "string"
  ) {
    throw new Error("AUDIO_SERVER_MESSAGE_INVALID");
  }
  return value as AudioServerMessage;
}
