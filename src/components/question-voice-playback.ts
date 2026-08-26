import { DEV_V1_INFORMATION_CATALOG } from "@/domain/information-catalog";
import { preferredQuestionInfoCodesAfterAnswer } from "@/domain/question-selector";

let sharedQuestionVoiceContext: AudioContext | null = null;

export interface QuestionVoiceChunk {
  bytes: ArrayBuffer;
  contentType: string;
}

const questionVoiceCache = new Map<string, Promise<QuestionVoiceChunk>>();
const MAX_CACHED_QUESTION_CHUNKS = 24;
const CATEGORY_PHASE = {
  CURRENT_STATE: 0,
  IMPROVEMENT_INTENT: 1,
  FUTURE_OUTLOOK: 2,
  HOUSEHOLD_STATE: 3,
} as const;
const PRIORITY_WEIGHT = { P0: 0, P1: 1, P2: 2 } as const;

export interface PredictiveQuestionInformationItem {
  infoCode: string;
  status: string;
  category?: string;
  priority?: string;
}

export interface PresentedQuestion {
  /** The one authoritative sentence shown, spoken, and stored in local review. */
  text: string | null;
  /** Optional contextual lead-in authored by the server, shown but not spoken. */
  context: string | null;
}

export interface AutoQuestionVoiceState {
  method: "chat" | "voice";
  voiceAutoplayEnabled: boolean;
  promptToSpeak: string | null;
  speaking: boolean;
  speechPreparing: boolean;
  voiceBusy: boolean;
  lastSpokenQuestion: string | null;
}

/**
 * Keeps the authoritative next question behind any acknowledgement that is
 * still being prepared or played. Once that acknowledgement settles, the
 * latest prompt becomes eligible exactly once through lastSpokenQuestion.
 */
export function shouldAutoPlayQuestionVoice(state: AutoQuestionVoiceState): boolean {
  return state.method === "voice" &&
    state.voiceAutoplayEnabled &&
    state.promptToSpeak !== null &&
    !state.speaking &&
    !state.speechPreparing &&
    !state.voiceBusy &&
    state.lastSpokenQuestion !== state.promptToSpeak;
}

function normalizeSpeechText(value: string | null | undefined): string | null {
  return value?.replace(/\s+/g, " ").trim() || null;
}

function escapedPattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function conflictSpeechVariants(label: string): readonly string[] {
  return [
    `기존 자료와 차이가 있습니다. ${label}의 기준 기간과 포함된 매출 채널을 확인해 주세요.`,
    `기존 자료와 차이가 있습니다. ${label}의 산정 기준을 확인해 주세요.`,
  ];
}

/**
 * Resolves one presentation sentence for the current turn. Ordinary and
 * follow-up questions use the finite catalog wording, so high-quality Qwen
 * audio is already cached. If Claude added a short grounded reaction before
 * that exact question, the reaction remains visible as context. The question
 * bubble, replay, microphone prompt, and borrower-side history all use `text`,
 * so a borrower never hears wording different from what they are answering.
 * The two finite server-owned conflict templates receive the same treatment,
 * while an unknown conflict sentence remains verbatim.
 */
export function presentedQuestion(input: {
  infoCode: string | null;
  questionReason: string | null;
  displayedQuestion: string | null;
}): PresentedQuestion {
  const displayed = normalizeSpeechText(input.displayedQuestion);
  if (!input.infoCode) {
    return { text: displayed, context: null };
  }
  const definition = DEV_V1_INFORMATION_CATALOG.find(
    (item) => item.infoCode === input.infoCode,
  );
  if (!definition) return { text: displayed, context: null };
  if (input.questionReason === "CONFLICT") {
    const canonicalConflict = conflictSpeechVariants(definition.label).find(
      (candidate) => displayed === candidate || displayed?.endsWith(candidate),
    ) ?? null;
    if (!canonicalConflict) return { text: displayed, context: null };
    const contextualPrefix = displayed
      ?.replace(new RegExp(`${escapedPattern(canonicalConflict)}$`, "u"), "")
      .trim();
    return {
      text: canonicalConflict,
      context: contextualPrefix && contextualPrefix !== displayed
        ? contextualPrefix
        : null,
    };
  }
  const canonical = normalizeSpeechText(
    input.questionReason === "FOLLOWUP"
      ? definition.followupQuestion ?? definition.question
      : definition.question,
  );
  if (!canonical) return { text: displayed, context: null };
  if (!displayed || displayed === canonical) {
    return { text: canonical, context: null };
  }
  const contextualPrefix = displayed
    .replace(new RegExp(`${escapedPattern(canonical)}$`, "u"), "")
    .trim();
  return {
    text: canonical,
    context: contextualPrefix && contextualPrefix !== displayed
      ? contextualPrefix
      : null,
  };
}

/** Backward-compatible helper for non-UI callers that need only speech text. */
export function canonicalQuestionForSpeech(input: {
  infoCode: string | null;
  questionReason: string | null;
  displayedQuestion: string | null;
}): string | null {
  return presentedQuestion(input).text;
}

function splitLongSpeechSegment(segment: string, maximumLength: number): string[] {
  const chunks: string[] = [];
  let remaining = segment.trim();
  while (remaining.length > maximumLength) {
    const window = remaining.slice(0, maximumLength + 1);
    const candidates = [window.lastIndexOf(", "), window.lastIndexOf(" ")];
    const splitAt = Math.max(...candidates);
    const boundary = splitAt >= Math.floor(maximumLength * 0.55) ? splitAt + 1 : maximumLength;
    chunks.push(remaining.slice(0, boundary).trim());
    remaining = remaining.slice(boundary).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

/**
 * Qwen returns a complete waveform per request. Short sentence-sized requests
 * let the first phrase start while the next phrase is being synthesized.
 */
export function splitQuestionForSpeech(text: string, maximumLength = 84): string[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.match(/[^.!?…]+(?:[.!?…]+|$)/g) ?? [normalized];
  const chunks: string[] = [];
  let current = "";
  for (const rawSentence of sentences) {
    for (const sentence of splitLongSpeechSegment(rawSentence, maximumLength)) {
      const combined = current ? `${current} ${sentence}` : sentence;
      if (combined.length <= maximumLength) {
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

/** Keeps replay and repeated transition phrases instant without persisting audio. */
export function cachedQuestionVoiceChunk(
  text: string,
  loader: () => Promise<QuestionVoiceChunk>,
): Promise<QuestionVoiceChunk> {
  const key = text.trim();
  const existing = questionVoiceCache.get(key);
  if (existing) {
    questionVoiceCache.delete(key);
    questionVoiceCache.set(key, existing);
    return existing;
  }
  const pending = loader().catch((error) => {
    questionVoiceCache.delete(key);
    throw error;
  });
  questionVoiceCache.set(key, pending);
  while (questionVoiceCache.size > MAX_CACHED_QUESTION_CHUNKS) {
    const oldest = questionVoiceCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    questionVoiceCache.delete(oldest);
  }
  return pending;
}

/**
 * Predict only canonical core questions. The result is used exclusively to
 * warm the audio cache; the server response remains the sole authority for
 * which question is shown or played.
 *
 * Follow-up/conflict states are deliberately excluded because the exact next
 * turn depends on the borrower's answer. If one is already pending elsewhere,
 * no prediction is made so speculative synthesis cannot compete with it.
 */
export function predictCanonicalNextQuestions(
  currentInfoCode: string | null,
  informationItems: readonly PredictiveQuestionInformationItem[],
  maximumCandidates = 1,
): string[] {
  if (!currentInfoCode || maximumCandidates <= 0) return [];
  if (!DEV_V1_INFORMATION_CATALOG.some((item) => item.infoCode === currentInfoCode)) return [];

  const byCode = new Map(informationItems.map((item) => [item.infoCode, item]));
  const hasUnpredictablePendingItem = informationItems.some(
    (item) =>
      item.infoCode !== currentInfoCode &&
      ["ASKING", "NEEDS_FOLLOWUP", "CONFLICT"].includes(item.status),
  );
  if (hasUnpredictablePendingItem) return [];

  const dependencyReady = (infoCode: string) => {
    if (infoCode === currentInfoCode) return true;
    return ["COLLECTED", "CONFIRMED", "NOT_APPLICABLE"].includes(byCode.get(infoCode)?.status ?? "");
  };
  const preferred = preferredQuestionInfoCodesAfterAnswer(currentInfoCode);

  return DEV_V1_INFORMATION_CATALOG
    .filter((definition) => {
      if (definition.infoCode === currentInfoCode) return false;
      if (byCode.get(definition.infoCode)?.status !== "NEEDED") return false;
      return definition.dependencies.every(dependencyReady);
    })
    .sort((left, right) => {
      const leftPreferred = preferred.indexOf(left.infoCode);
      const rightPreferred = preferred.indexOf(right.infoCode);
      const leftPreferenceRank = leftPreferred < 0 ? Number.MAX_SAFE_INTEGER : leftPreferred;
      const rightPreferenceRank = rightPreferred < 0 ? Number.MAX_SAFE_INTEGER : rightPreferred;
      if (leftPreferenceRank !== rightPreferenceRank) {
        return leftPreferenceRank - rightPreferenceRank;
      }

      const leftItem = byCode.get(left.infoCode);
      const rightItem = byCode.get(right.infoCode);
      const leftCategory = leftItem?.category ?? left.category;
      const rightCategory = rightItem?.category ?? right.category;
      const categoryDifference =
        (CATEGORY_PHASE[leftCategory as keyof typeof CATEGORY_PHASE] ?? Number.MAX_SAFE_INTEGER) -
        (CATEGORY_PHASE[rightCategory as keyof typeof CATEGORY_PHASE] ?? Number.MAX_SAFE_INTEGER);
      if (categoryDifference !== 0) return categoryDifference;

      const leftPriority = leftItem?.priority ?? left.priority;
      const rightPriority = rightItem?.priority ?? right.priority;
      const priorityDifference =
        (PRIORITY_WEIGHT[leftPriority as keyof typeof PRIORITY_WEIGHT] ?? Number.MAX_SAFE_INTEGER) -
        (PRIORITY_WEIGHT[rightPriority as keyof typeof PRIORITY_WEIGHT] ?? Number.MAX_SAFE_INTEGER);
      if (priorityDifference !== 0) return priorityDifference;
      return left.infoCode.localeCompare(right.infoCode);
    })
    .slice(0, maximumCandidates)
    .map((definition) => definition.question);
}

/**
 * Warms only the first audio chunk. That is enough to make an authoritative
 * matching question start immediately without filling the queue with speech
 * that may never be used. Rejections are intentionally isolated from the UI.
 */
export async function prefetchQuestionVoiceFirstChunks(
  texts: readonly string[],
  loader: (chunk: string) => Promise<QuestionVoiceChunk>,
  maximumCandidates = 1,
): Promise<void> {
  const firstChunks = [...new Set(
    texts.flatMap((text) => splitQuestionForSpeech(text).slice(0, 1)),
  )].slice(0, Math.max(0, maximumCandidates));
  await Promise.allSettled(
    firstChunks.map((chunk) => cachedQuestionVoiceChunk(chunk, () => loader(chunk))),
  );
}

function audioContextConstructor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  const audioWindow = window as typeof window & { webkitAudioContext?: typeof AudioContext };
  return audioWindow.AudioContext ?? audioWindow.webkitAudioContext ?? null;
}

/**
 * Must run synchronously inside the borrower's "voice interview" click. The
 * unlocked context survives Next client-side navigation, so the first question
 * can begin after the interview API has created the session and TTS completes.
 */
export function unlockQuestionVoicePlayback(): AudioContext | null {
  const AudioContextConstructor = audioContextConstructor();
  if (!AudioContextConstructor) return null;
  if (!sharedQuestionVoiceContext || sharedQuestionVoiceContext.state === "closed") {
    sharedQuestionVoiceContext = new AudioContextConstructor();
  }
  void sharedQuestionVoiceContext.resume();
  return sharedQuestionVoiceContext;
}

export function currentQuestionVoicePlayback(): AudioContext | null {
  return sharedQuestionVoiceContext?.state === "closed" ? null : sharedQuestionVoiceContext;
}

export function releaseQuestionVoicePlayback(context: AudioContext | null): void {
  if (!context || context !== sharedQuestionVoiceContext) return;
  sharedQuestionVoiceContext = null;
  void context.close();
}
