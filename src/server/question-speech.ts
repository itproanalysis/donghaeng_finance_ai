import { ApplicationError } from "./errors";

export const QUESTION_SPEECH_MAX_TEXT_LENGTH = 3_000;
const QUESTION_SPEECH_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const QUESTION_SPEECH_TIMEOUT_MS = 30_000;
const DEFAULT_TTS_ENDPOINT = "http://127.0.0.1:8766/v1/audio/speech";
// The 1.7B CustomVoice release provides materially more natural Korean prosody
// and instruction control than the former 0.6B local runtime.
const DEFAULT_TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice";
const DEFAULT_TTS_VOICE = "Sohee";

export interface QuestionSpeechEnvironment {
  DONGHAENG_TTS_ENDPOINT?: string;
  DONGHAENG_TTS_API_KEY?: string;
  DONGHAENG_TTS_MODEL?: string;
  DONGHAENG_TTS_VOICE?: string;
}

export interface QuestionSpeechResult {
  bytes: Uint8Array;
  contentType: string;
}

export interface SynthesizeQuestionSpeechOptions {
  environment?: QuestionSpeechEnvironment;
  fetchImpl?: typeof fetch;
}

function configuredUrl(environment: QuestionSpeechEnvironment): URL {
  const value = environment.DONGHAENG_TTS_ENDPOINT?.trim() || DEFAULT_TTS_ENDPOINT;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("Unsupported protocol");
    }
    return url;
  } catch {
    throw new ApplicationError(503, "QUESTION_TTS_NOT_CONFIGURED", "AI 음성 설정을 확인할 수 없습니다.");
  }
}

async function readBoundedAudio(response: Response): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > QUESTION_SPEECH_MAX_AUDIO_BYTES) {
    throw new ApplicationError(502, "QUESTION_TTS_RESPONSE_TOO_LARGE", "AI 음성 응답이 너무 큽니다.");
  }

  if (!response.body) {
    throw new ApplicationError(502, "QUESTION_TTS_EMPTY", "AI 음성 응답이 비어 있습니다.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > QUESTION_SPEECH_MAX_AUDIO_BYTES) {
        throw new ApplicationError(502, "QUESTION_TTS_RESPONSE_TOO_LARGE", "AI 음성 응답이 너무 큽니다.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) {
    throw new ApplicationError(502, "QUESTION_TTS_EMPTY", "AI 음성 응답이 비어 있습니다.");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/**
 * Produces only an ephemeral audio response. The question text and TTS secret
 * never leave this server boundary through the browser bundle or logs.
 */
export async function synthesizeQuestionSpeech(
  text: string,
  options: SynthesizeQuestionSpeechOptions = {},
): Promise<QuestionSpeechResult> {
  const normalizedText = text.trim();
  if (!normalizedText || normalizedText.length > QUESTION_SPEECH_MAX_TEXT_LENGTH) {
    throw new ApplicationError(400, "INVALID_QUESTION_SPEECH_TEXT", "읽을 질문은 1~3,000자여야 합니다.");
  }

  const environment: QuestionSpeechEnvironment = options.environment ?? {
    DONGHAENG_TTS_ENDPOINT: process.env.DONGHAENG_TTS_ENDPOINT,
    DONGHAENG_TTS_API_KEY: process.env.DONGHAENG_TTS_API_KEY,
    DONGHAENG_TTS_MODEL: process.env.DONGHAENG_TTS_MODEL,
    DONGHAENG_TTS_VOICE: process.env.DONGHAENG_TTS_VOICE,
  };
  const fetchImpl = options.fetchImpl ?? fetch;
  const endpoint = configuredUrl(environment);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), QUESTION_SPEECH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${environment.DONGHAENG_TTS_API_KEY?.trim() || "local-tts-runtime"}`,
        "Content-Type": "application/json",
        "Accept": "audio/wav, audio/mpeg, audio/*;q=0.8",
      },
      body: JSON.stringify({
        input: normalizedText,
        model: environment.DONGHAENG_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL,
        voice: environment.DONGHAENG_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE,
        response_format: "wav",
      }),
      signal: controller.signal,
      redirect: "error",
    });
    if (!response.ok) {
      throw new ApplicationError(503, "QUESTION_TTS_UNAVAILABLE", "AI 음성을 준비하지 못했습니다. 질문은 텍스트로 확인할 수 있습니다.");
    }
    const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() ?? "";
    if (!contentType.startsWith("audio/")) {
      throw new ApplicationError(502, "QUESTION_TTS_INVALID_RESPONSE", "AI 음성 응답 형식이 올바르지 않습니다.");
    }
    return { bytes: await readBoundedAudio(response), contentType };
  } catch (error) {
    if (error instanceof ApplicationError) throw error;
    if (controller.signal.aborted) {
      throw new ApplicationError(504, "QUESTION_TTS_TIMEOUT", "AI 음성 준비 시간이 초과되었습니다. 질문은 텍스트로 확인할 수 있습니다.");
    }
    throw new ApplicationError(503, "QUESTION_TTS_UNAVAILABLE", "AI 음성을 준비하지 못했습니다. 질문은 텍스트로 확인할 수 있습니다.");
  } finally {
    clearTimeout(timeout);
  }
}
