export type RealtimeLatencyPhase =
  | "speechToRecognized"
  | "recognizedToAccepted"
  | "acceptedToQuestionReady"
  | "speechToQuestionReady"
  | "ttsRequestToFirstByte"
  | "ttsFirstByteToPlayback"
  | "ttsRequestToPlayback";

export type RealtimeProcessingStatus =
  | "APPLIED"
  | "RETRYABLE_FAILURE"
  | "NON_RETRYABLE_FAILURE";

export type RealtimeLatencyHealth = "WAITING" | "ACTIVE" | "FAST" | "DELAYED";
export type RealtimeLatencySloStatus = "NO_DATA" | "MEETING" | "BREACHED";

export interface RealtimeLatencyDistribution {
  latestMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  samples: number;
}

export interface RealtimeLatencySnapshot {
  health: RealtimeLatencyHealth;
  turnSamples: number;
  ttsSamples: number;
  phases: Record<RealtimeLatencyPhase, RealtimeLatencyDistribution>;
  providers: {
    stt: string | null;
    ai: string | null;
    model: string | null;
    tts: string | null;
  };
  processingStatus: RealtimeProcessingStatus | null;
  fallback: {
    ai: boolean | null;
    tts: boolean | null;
  };
  slo: {
    status: RealtimeLatencySloStatus;
    breachedPhases: readonly RealtimeLatencyPhase[];
  };
}

interface AudioTurnMarkers {
  // The audio session identifier is deliberately private to this store. It is
  // used only to correlate monotonic marks and never leaves getSnapshot().
  key: string;
  speechEndedAt: number | null;
  recognizedAt: number | null;
  acceptedAt: number | null;
  questionReadyAt: number | null;
  sttProvider: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  processingStatus: RealtimeProcessingStatus | null;
  aiFallback: boolean | null;
}

interface TtsMarkers {
  token: number;
  requestedAt: number;
  firstByteAt: number | null;
  playbackAt: number | null;
  provider: string | null;
  fallback: boolean | null;
}

interface RealtimeLatencyTelemetryOptions {
  now?: () => number;
  maxSamples?: number;
}

type Listener = () => void;

const PHASES: readonly RealtimeLatencyPhase[] = [
  "speechToRecognized",
  "recognizedToAccepted",
  "acceptedToQuestionReady",
  "speechToQuestionReady",
  "ttsRequestToFirstByte",
  "ttsFirstByteToPlayback",
  "ttsRequestToPlayback",
];

export const REALTIME_LATENCY_SLO_MS: Readonly<Record<RealtimeLatencyPhase, number>> =
  Object.freeze({
    speechToRecognized: 2_000,
    recognizedToAccepted: 2_500,
    acceptedToQuestionReady: 750,
    speechToQuestionReady: 4_500,
    ttsRequestToFirstByte: 1_000,
    ttsFirstByteToPlayback: 500,
    ttsRequestToPlayback: 1_500,
  });

function emptyDistribution(): RealtimeLatencyDistribution {
  return { latestMs: null, p50Ms: null, p95Ms: null, samples: 0 };
}

function emptySnapshot(): RealtimeLatencySnapshot {
  return {
    health: "WAITING",
    turnSamples: 0,
    ttsSamples: 0,
    phases: Object.fromEntries(
      PHASES.map((phase) => [phase, emptyDistribution()]),
    ) as Record<RealtimeLatencyPhase, RealtimeLatencyDistribution>,
    providers: { stt: null, ai: null, model: null, tts: null },
    processingStatus: null,
    fallback: { ai: null, tts: null },
    slo: { status: "NO_DATA", breachedPhases: [] },
  };
}

const SERVER_SNAPSHOT = emptySnapshot();

function duration(start: number | null, end: number | null): number | null {
  if (start === null || end === null || end < start) return null;
  return Math.round(end - start);
}

function quantile(sorted: readonly number[], percentile: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil(sorted.length * percentile) - 1);
  return sorted[index] ?? null;
}

function distribution(values: readonly number[]): RealtimeLatencyDistribution {
  const sorted = [...values].sort((left, right) => left - right);
  return {
    latestMs: values.at(-1) ?? null,
    p50Ms: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    samples: values.length,
  };
}

function safeSttProvider(value: string | null | undefined): string | null {
  const normalized = value?.toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized.includes("whisper") || normalized.includes("large-v3")) {
    return "로컬 Whisper";
  }
  if (normalized.includes("openai") || normalized.includes("transcribe")) {
    return "OpenAI STT";
  }
  return "STT 연결";
}

function safeAiProvider(value: string | null | undefined): string | null {
  const normalized = value?.toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized === "anthropic" || normalized.includes("claude")) return "Claude";
  if (normalized === "deterministic" || normalized.includes("local")) {
    return "로컬 안전 처리";
  }
  return "AI 연결";
}

function safeAiModel(value: string | null | undefined): string | null {
  if (value === "claude-haiku-4-5-20251001") return "Haiku 4.5";
  if (value === "claude-sonnet-5") return "Sonnet 5";
  if (value === "local-realtime-fallback-v1") return "로컬 fallback";
  return null;
}

function safeTtsProvider(value: string | null | undefined): string | null {
  const normalized = value?.toLowerCase() ?? "";
  if (!normalized) return null;
  if (normalized.includes("qwen")) return "Qwen3-TTS";
  if (normalized.includes("device") || normalized.includes("browser")) {
    return "기기 음성";
  }
  return "TTS 연결";
}

function phaseValues(
  phase: RealtimeLatencyPhase,
  turns: readonly AudioTurnMarkers[],
  tts: readonly TtsMarkers[],
): number[] {
  if (phase === "speechToRecognized") {
    return turns.flatMap((turn) => {
      const value = duration(turn.speechEndedAt, turn.recognizedAt);
      return value === null ? [] : [value];
    });
  }
  if (phase === "recognizedToAccepted") {
    return turns.flatMap((turn) => {
      const value = duration(turn.recognizedAt, turn.acceptedAt);
      return value === null ? [] : [value];
    });
  }
  if (phase === "acceptedToQuestionReady") {
    return turns.flatMap((turn) => {
      const value = duration(turn.acceptedAt, turn.questionReadyAt);
      return value === null ? [] : [value];
    });
  }
  if (phase === "speechToQuestionReady") {
    return turns.flatMap((turn) => {
      const value = duration(turn.speechEndedAt, turn.questionReadyAt);
      return value === null ? [] : [value];
    });
  }
  if (phase === "ttsRequestToFirstByte") {
    return tts.flatMap((sample) => {
      const value = duration(sample.requestedAt, sample.firstByteAt);
      return value === null ? [] : [value];
    });
  }
  if (phase === "ttsFirstByteToPlayback") {
    return tts.flatMap((sample) => {
      const value = duration(sample.firstByteAt, sample.playbackAt);
      return value === null ? [] : [value];
    });
  }
  return tts.flatMap((sample) => {
    const value = duration(sample.requestedAt, sample.playbackAt);
    return value === null ? [] : [value];
  });
}

export class RealtimeLatencyTelemetry {
  private readonly now: () => number;
  private readonly maxSamples: number;
  private readonly listeners = new Set<Listener>();
  private turns: AudioTurnMarkers[] = [];
  private tts: TtsMarkers[] = [];
  private nextTtsToken = 1;
  private snapshot: RealtimeLatencySnapshot = emptySnapshot();

  constructor(options: RealtimeLatencyTelemetryOptions = {}) {
    this.now = options.now ?? (() => globalThis.performance?.now() ?? Date.now());
    this.maxSamples = Math.max(1, Math.min(256, options.maxSamples ?? 64));
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): RealtimeLatencySnapshot => this.snapshot;

  getServerSnapshot = (): RealtimeLatencySnapshot => SERVER_SNAPSHOT;

  beginAudioTurn(audioSessionId: string): void {
    if (!audioSessionId || this.turns.some((turn) => turn.key === audioSessionId)) return;
    this.turns.push({
      key: audioSessionId,
      speechEndedAt: null,
      recognizedAt: null,
      acceptedAt: null,
      questionReadyAt: null,
      sttProvider: null,
      aiProvider: null,
      aiModel: null,
      processingStatus: null,
      aiFallback: null,
    });
    this.trim();
    this.publish();
  }

  markSpeechEnded(audioSessionId: string): void {
    const turn = this.findTurn(audioSessionId);
    if (!turn || turn.speechEndedAt !== null) return;
    turn.speechEndedAt = this.now();
    this.publish();
  }

  markRecognized(audioSessionId: string, sttProvider?: string | null): void {
    const turn = this.findTurn(audioSessionId);
    if (!turn) return;
    if (turn.recognizedAt === null) turn.recognizedAt = this.now();
    turn.sttProvider = safeSttProvider(sttProvider) ?? turn.sttProvider;
    this.publish();
  }

  markProcessingResult(
    audioSessionId: string,
    result: {
      status: RealtimeProcessingStatus;
      provider?: string | null;
      model?: string | null;
      fallback?: boolean | null;
    },
  ): void {
    const turn = this.findTurn(audioSessionId);
    if (!turn) return;
    if (turn.acceptedAt === null) turn.acceptedAt = this.now();
    turn.processingStatus = result.status;
    turn.aiProvider = safeAiProvider(result.provider) ?? turn.aiProvider;
    turn.aiModel = safeAiModel(result.model) ?? turn.aiModel;
    turn.aiFallback = result.fallback ?? turn.aiFallback;
    this.publish();
  }

  markNextQuestionReady(): void {
    const turn = [...this.turns]
      .reverse()
      .find((candidate) => candidate.acceptedAt !== null && candidate.questionReadyAt === null);
    if (!turn) return;
    turn.questionReadyAt = this.now();
    this.publish();
  }

  annotateLatestAi(result: {
    provider?: string | null;
    model?: string | null;
    fallback?: boolean | null;
  }): void {
    const turn = [...this.turns].reverse().find((candidate) => candidate.acceptedAt !== null);
    if (!turn) return;
    turn.aiProvider = safeAiProvider(result.provider) ?? turn.aiProvider;
    turn.aiModel = safeAiModel(result.model) ?? turn.aiModel;
    turn.aiFallback = result.fallback ?? turn.aiFallback;
    this.publish();
  }

  beginTtsRequest(provider?: string | null): number {
    const token = this.nextTtsToken;
    this.nextTtsToken += 1;
    this.tts.push({
      token,
      requestedAt: this.now(),
      firstByteAt: null,
      playbackAt: null,
      provider: safeTtsProvider(provider),
      fallback: null,
    });
    this.trim();
    this.publish();
    return token;
  }

  markTtsFirstByte(token: number, provider?: string | null): void {
    const sample = this.tts.find((candidate) => candidate.token === token);
    if (!sample) return;
    if (sample.firstByteAt === null) sample.firstByteAt = this.now();
    sample.provider = safeTtsProvider(provider) ?? sample.provider;
    this.publish();
  }

  markTtsPlaybackStarted(
    token: number,
    result: { provider?: string | null; fallback?: boolean | null } = {},
  ): void {
    const sample = this.tts.find((candidate) => candidate.token === token);
    if (!sample) return;
    if (sample.playbackAt === null) sample.playbackAt = this.now();
    sample.provider = safeTtsProvider(result.provider) ?? sample.provider;
    sample.fallback = result.fallback ?? sample.fallback;
    this.publish();
  }

  private findTurn(key: string): AudioTurnMarkers | undefined {
    return this.turns.find((turn) => turn.key === key);
  }

  private trim(): void {
    if (this.turns.length > this.maxSamples) {
      this.turns = this.turns.slice(-this.maxSamples);
    }
    if (this.tts.length > this.maxSamples) {
      this.tts = this.tts.slice(-this.maxSamples);
    }
  }

  private publish(): void {
    const latestTurn = this.turns.at(-1) ?? null;
    const latestTts = this.tts.at(-1) ?? null;
    const phases = Object.fromEntries(
      PHASES.map((phase) => [phase, distribution(phaseValues(phase, this.turns, this.tts))]),
    ) as Record<RealtimeLatencyPhase, RealtimeLatencyDistribution>;
    const hasMarks = this.turns.length > 0 || this.tts.length > 0;
    const hasCompletedPhase = PHASES.some((phase) => phases[phase].samples > 0);
    const breachedPhases = PHASES.filter((phase) => {
      const distributionValue = phases[phase];
      // Before five samples, latest gives an immediate demo signal. Once the
      // bounded window has enough observations, the SLO is evaluated at p95.
      const observed = distributionValue.samples >= 5
        ? distributionValue.p95Ms
        : distributionValue.latestMs;
      return observed !== null && observed > REALTIME_LATENCY_SLO_MS[phase];
    });
    const sloStatus: RealtimeLatencySloStatus = !hasCompletedPhase
      ? "NO_DATA"
      : breachedPhases.length > 0
        ? "BREACHED"
        : "MEETING";

    this.snapshot = {
      health: !hasMarks
        ? "WAITING"
        : sloStatus === "BREACHED"
          ? "DELAYED"
          : hasCompletedPhase
            ? "FAST"
            : "ACTIVE",
      turnSamples: this.turns.length,
      ttsSamples: this.tts.length,
      phases,
      providers: {
        stt: latestTurn?.sttProvider ?? null,
        ai: latestTurn?.aiProvider ?? null,
        model: latestTurn?.aiModel ?? null,
        tts: latestTts?.provider ?? null,
      },
      processingStatus: latestTurn?.processingStatus ?? null,
      fallback: {
        ai: latestTurn?.aiFallback ?? null,
        tts: latestTts?.fallback ?? null,
      },
      slo: { status: sloStatus, breachedPhases },
    };
    for (const listener of this.listeners) listener();
  }
}

export const realtimeLatencyTelemetry = new RealtimeLatencyTelemetry();
