import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { DEV_V1_ALL_INFORMATION_CATALOG } from "@/domain/information-catalog";

import { ApplicationError } from "./errors";

export const QUESTION_SPEECH_MAX_TEXT_LENGTH = 3_000;
const QUESTION_SPEECH_MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const QUESTION_SPEECH_TIMEOUT_MS = 30_000;
const DEFAULT_TTS_ENDPOINT = "http://127.0.0.1:8766/v1/audio/speech";
// The official 0.6B CustomVoice model retains the Korean Sohee voice while
// materially reducing dynamic-turn latency on the local RTX 4070-class GPU.
// The 1.7B checkpoint remains usable through DONGHAENG_TTS_MODEL for offline
// pre-generation, but is not the realtime interview default.
const DEFAULT_TTS_MODEL = "Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice";
const DEFAULT_TTS_VOICE = "Sohee";
const MAX_QUESTION_SPEECH_CACHE_ENTRIES = 32;
const QUESTION_SPEECH_DISK_CACHE_DIRECTORY = path.join(
  process.cwd(),
  "data",
  "local-voice",
  "question-speech-cache",
);
const QUESTION_SPEECH_DISK_CACHE_SUFFIX = ".wav";
const QUESTION_SPEECH_CHUNK_LENGTH = 84;
const questionSpeechCache = new Map<string, Promise<QuestionSpeechResult>>();

const BORROWER_INTERVIEW_WELCOME =
  "안녕하세요, 사장님. 정답을 찾는 자리가 아니라 사장님 사업 이야기를 듣는 시간이에요. 편하게 말씀해 주세요.";
const BORROWER_TURN_BACKCHANNELS = [
  "네, 말씀 잘 들었어요. 잠시만 정리할게요.",
  "알겠습니다. 이어서 필요한 내용을 살펴볼게요.",
  "말씀해 주신 내용을 바탕으로 다음 질문을 준비할게요.",
] as const;

function splitLongCanonicalSpeechSegment(segment: string): string[] {
  const chunks: string[] = [];
  let remaining = segment.trim();
  while (remaining.length > QUESTION_SPEECH_CHUNK_LENGTH) {
    const window = remaining.slice(0, QUESTION_SPEECH_CHUNK_LENGTH + 1);
    const splitAt = Math.max(window.lastIndexOf(", "), window.lastIndexOf(" "));
    const boundary = splitAt >= Math.floor(QUESTION_SPEECH_CHUNK_LENGTH * 0.55)
      ? splitAt + 1
      : QUESTION_SPEECH_CHUNK_LENGTH;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Mirrors the borrower's fixed sentence-sized playback chunks. This helper is
 * used only to build a finite persistence allow-list; arbitrary request text is
 * never accepted merely because it resembles one of these phrases.
 */
function splitCanonicalSpeechText(text: string): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";
  for (const rawSentence of sentences) {
    for (const sentence of splitLongCanonicalSpeechSegment(rawSentence)) {
      const combined = current ? `${current} ${sentence}` : sentence;
      if (combined.length <= QUESTION_SPEECH_CHUNK_LENGTH) {
        current = combined;
      } else {
        if (current) chunks.push(current);
        current = sentence;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

const CANONICAL_QUESTION_SPEECH_TEXTS: string[] = DEV_V1_ALL_INFORMATION_CATALOG.flatMap(
  (item) => item.followupQuestion
    ? [item.question, item.followupQuestion]
    : [item.question],
);
const CANONICAL_CONFLICT_SPEECH_TEXTS: string[] = DEV_V1_ALL_INFORMATION_CATALOG.flatMap(
  (item) => [
    `기존 자료와 차이가 있습니다. ${item.label}의 기준 기간과 포함된 매출 채널을 확인해 주세요.`,
    `기존 자료와 차이가 있습니다. ${item.label}의 산정 기준을 확인해 주세요.`,
  ],
);
const FIRST_CANONICAL_QUESTION_SPEECH_TEXT = CANONICAL_QUESTION_SPEECH_TEXTS[0];
const CANONICAL_BORROWER_SPEECH_SOURCES = [
  BORROWER_INTERVIEW_WELCOME,
  ...(FIRST_CANONICAL_QUESTION_SPEECH_TEXT ? [FIRST_CANONICAL_QUESTION_SPEECH_TEXT] : []),
  ...BORROWER_TURN_BACKCHANNELS,
  ...CANONICAL_QUESTION_SPEECH_TEXTS.slice(1),
  ...CANONICAL_CONFLICT_SPEECH_TEXTS,
] as const;

/**
 * The only phrases eligible for persistent audio caching. Every entry is
 * application-owned, static and non-personal. The welcome/question composites
 * cover the first borrower turn, which is chunked after those strings join.
 */
export const PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST = Object.freeze([
  ...new Set([
    ...CANONICAL_BORROWER_SPEECH_SOURCES,
    ...CANONICAL_BORROWER_SPEECH_SOURCES.flatMap(splitCanonicalSpeechText),
    ...CANONICAL_QUESTION_SPEECH_TEXTS.flatMap((question) =>
      splitCanonicalSpeechText(`${BORROWER_INTERVIEW_WELCOME} ${question}`)
    ),
  ]),
]);
const persistentQuestionSpeechTextAllowlist = new Set<string>(
  PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST,
);

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
  /** Defaults to the repository-local cache. Pass null to disable disk I/O. */
  persistentCacheDirectory?: string | null;
}

export interface PersistentQuestionSpeechCacheCoverage {
  model: string;
  voice: string;
  total: number;
  cached: number;
  missingTexts: readonly string[];
}

function diskCacheKey(model: string, voice: string, text: string): string {
  return createHash("sha256")
    .update(model, "utf8")
    .update("\u0000", "utf8")
    .update(voice, "utf8")
    .update("\u0000", "utf8")
    .update(text, "utf8")
    .digest("hex");
}

function diskCachePath(cacheDirectory: string, cacheKey: string): string {
  return path.join(cacheDirectory, `${cacheKey}${QUESTION_SPEECH_DISK_CACHE_SUFFIX}`);
}

async function removeInvalidDiskCacheFile(filePath: string): Promise<void> {
  await unlink(filePath).catch(() => undefined);
}

async function readQuestionSpeechFromDisk(
  cacheDirectory: string,
  cacheKey: string,
): Promise<QuestionSpeechResult | null> {
  const filePath = diskCachePath(cacheDirectory, cacheKey);
  try {
    const file = await lstat(filePath);
    if (
      !file.isFile() ||
      file.isSymbolicLink() ||
      file.size < 1 ||
      file.size > QUESTION_SPEECH_MAX_AUDIO_BYTES
    ) {
      await removeInvalidDiskCacheFile(filePath);
      return null;
    }
    const bytes = await readFile(filePath);
    if (bytes.byteLength < 1 || bytes.byteLength > QUESTION_SPEECH_MAX_AUDIO_BYTES) {
      await removeInvalidDiskCacheFile(filePath);
      return null;
    }
    return {
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      contentType: "audio/wav",
    };
  } catch {
    return null;
  }
}

/**
 * Reports only application-owned phrases for the active model/voice cache key.
 * This is used by the local prewarm CLI so warm restarts never synthesize an
 * already persisted phrase. No user-derived text is inspected or returned.
 */
export async function inspectPersistentQuestionSpeechCache(
  options: {
    environment?: QuestionSpeechEnvironment;
    persistentCacheDirectory?: string | null;
  } = {},
): Promise<PersistentQuestionSpeechCacheCoverage> {
  const environment = options.environment ?? {
    DONGHAENG_TTS_MODEL: process.env.DONGHAENG_TTS_MODEL,
    DONGHAENG_TTS_VOICE: process.env.DONGHAENG_TTS_VOICE,
  };
  const model = environment.DONGHAENG_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
  const voice = environment.DONGHAENG_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE;
  const configuredCacheDirectory = options.persistentCacheDirectory === undefined
    ? QUESTION_SPEECH_DISK_CACHE_DIRECTORY
    : options.persistentCacheDirectory;
  const cacheDirectory = configuredCacheDirectory?.trim()
    ? path.resolve(configuredCacheDirectory)
    : null;
  const missingTexts: string[] = [];

  for (const text of PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST) {
    const cached = cacheDirectory
      ? await readQuestionSpeechFromDisk(cacheDirectory, diskCacheKey(model, voice, text))
      : null;
    if (!cached) missingTexts.push(text);
  }

  return {
    model,
    voice,
    total: PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST.length,
    cached: PERSISTENT_QUESTION_SPEECH_TEXT_ALLOWLIST.length - missingTexts.length,
    missingTexts,
  };
}

function isPersistableWave(contentType: string): boolean {
  return ["audio/wav", "audio/x-wav", "audio/wave"].includes(contentType);
}

async function writeQuestionSpeechToDisk(
  cacheDirectory: string,
  cacheKey: string,
  result: QuestionSpeechResult,
): Promise<void> {
  if (
    result.bytes.byteLength < 1 ||
    result.bytes.byteLength > QUESTION_SPEECH_MAX_AUDIO_BYTES ||
    !isPersistableWave(result.contentType)
  ) {
    return;
  }

  const filePath = diskCachePath(cacheDirectory, cacheKey);
  const temporaryPath = path.join(
    cacheDirectory,
    `.${cacheKey}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await mkdir(cacheDirectory, { recursive: true });
    await writeFile(temporaryPath, result.bytes, { flag: "wx" });
    await rename(temporaryPath, filePath);
  } catch {
    // Disk persistence is a latency optimization. A read-only/full disk must
    // never turn an otherwise valid TTS response into an interview failure.
  } finally {
    await unlink(temporaryPath).catch(() => undefined);
  }
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
 * Produces a bounded audio response. Static application-owned phrases may be
 * persisted locally; dynamic text and the TTS secret remain ephemeral.
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
  const model = environment.DONGHAENG_TTS_MODEL?.trim() || DEFAULT_TTS_MODEL;
  const voice = environment.DONGHAENG_TTS_VOICE?.trim() || DEFAULT_TTS_VOICE;
  const memoryCacheKey = [
    endpoint.toString(),
    model,
    voice,
    normalizedText,
  ].join("\u0000");
  const configuredCacheDirectory = options.persistentCacheDirectory === undefined
    ? QUESTION_SPEECH_DISK_CACHE_DIRECTORY
    : options.persistentCacheDirectory;
  const persistentCacheDirectory =
    persistentQuestionSpeechTextAllowlist.has(normalizedText) &&
    configuredCacheDirectory?.trim()
      ? path.resolve(configuredCacheDirectory)
      : null;
  const persistentCacheKey = persistentCacheDirectory
    ? diskCacheKey(model, voice, normalizedText)
    : null;
  const loadSpeech = async (): Promise<QuestionSpeechResult> => {
    if (persistentCacheDirectory && persistentCacheKey) {
      const diskCached = await readQuestionSpeechFromDisk(
        persistentCacheDirectory,
        persistentCacheKey,
      );
      if (diskCached) return diskCached;
    }
    const synthesized = await synthesizeUncachedQuestionSpeech(
      normalizedText,
      environment,
      endpoint,
      fetchImpl,
    );
    if (persistentCacheDirectory && persistentCacheKey) {
      await writeQuestionSpeechToDisk(
        persistentCacheDirectory,
        persistentCacheKey,
        synthesized,
      );
    }
    return synthesized;
  };
  // Tests and injected transports stay fully isolated. Runtime requests share
  // a bounded in-memory LRU. An explicitly injected cache directory still
  // permits focused tests to exercise persistence without sharing memory.
  if (options.fetchImpl === undefined) {
    const cached = questionSpeechCache.get(memoryCacheKey);
    if (cached) {
      questionSpeechCache.delete(memoryCacheKey);
      questionSpeechCache.set(memoryCacheKey, cached);
      return cached;
    }
    const pending = loadSpeech().catch((error) => {
      questionSpeechCache.delete(memoryCacheKey);
      throw error;
    });
    questionSpeechCache.set(memoryCacheKey, pending);
    while (questionSpeechCache.size > MAX_QUESTION_SPEECH_CACHE_ENTRIES) {
      const oldest = questionSpeechCache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      questionSpeechCache.delete(oldest);
    }
    return pending;
  }
  return loadSpeech();
}

async function synthesizeUncachedQuestionSpeech(
  normalizedText: string,
  environment: QuestionSpeechEnvironment,
  endpoint: URL,
  fetchImpl: typeof fetch,
): Promise<QuestionSpeechResult> {
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
