"use client";

import { ChevronDown, ChevronRight, LoaderCircle, MessageCircle, Mic, RefreshCw, Send, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { AudioInterviewControls } from "@/components/audio-interview-controls";
import { BorrowerCompletionReview } from "@/components/borrower-completion-review";
import { BorrowerResult } from "@/components/borrower-result";
import { canOfferBorrowerCompletion } from "@/components/borrower-completion";
import { buildBorrowerConversationGuide } from "@/components/borrower-conversation-guide";
import { buildBorrowerExperience } from "@/components/borrower-experience";
import {
  buildEvidenceCuriosityCard,
  buildGroundedScenarioPrompt,
  reconstructQuestionAnswerHistory,
} from "@/components/borrower-immersive-prompts";
import { borrowerMessageCommandPayload } from "@/components/borrower-message-command";
import { useDemoAutoplay } from "@/components/demo-autoplay";
import { OPERATING_DAY_DEMO_SCENARIO } from "@/domain/demo-scenario";
import { RealtimeLatencyStatus } from "@/components/realtime-latency-status";
import { RealtimeVoiceInterview } from "@/components/realtime-voice-interview";
import {
  currentQuestionVoicePlayback,
  cachedQuestionVoiceChunk,
  predictCanonicalNextQuestions,
  presentedQuestion,
  prefetchQuestionVoiceFirstChunks,
  releaseQuestionVoicePlayback,
  shouldAutoPlayQuestionVoice,
  splitQuestionForSpeech,
  unlockQuestionVoicePlayback,
} from "@/components/question-voice-playback";
import {
  adaptInterviewSnapshot,
  authenticatedFetch,
  createClientCommandId,
  diffLiveFeatureSnapshots,
  extractMessageProcessingTelemetry,
  readApiEnvelope,
  type InterviewSnapshotView,
  type LiveFeaturePreviewChangeView,
  type LiveInterviewView,
  type PendingMessageCommandView,
} from "@/components/api-adapter";
import { realtimeLatencyTelemetry } from "@/realtime/latency-telemetry";

type InterviewMethod = "chat" | "voice";
type VoiceProvider = "qwen" | "openai" | "server" | "device";

const QUESTION_SPEECH_ENDPOINT = "/api/voice/speech";
const INTERVIEW_WELCOME = "안녕하세요, 사장님. 정답을 찾는 자리가 아니라 사장님 사업 이야기를 듣는 시간이에요. 편하게 말씀해 주세요.";
const TURN_BACKCHANNELS = [
  "네, 말씀 잘 들었어요. 잠시만 정리할게요.",
  "알겠습니다. 이어서 필요한 내용을 살펴볼게요.",
  "말씀해 주신 내용을 바탕으로 다음 질문을 준비할게요.",
] as const;
const MAX_QUESTION_SPEECH_BYTES = 8 * 1024 * 1024;

async function readSpeechResponse(
  response: Response,
  onFirstByte: () => void,
): Promise<ArrayBuffer> {
  if (!response.body) {
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength > 0) onFirstByte();
    return bytes;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let observedFirstByte = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if (!observedFirstByte) {
        observedFirstByte = true;
        onFirstByte();
      }
      total += value.byteLength;
      if (total > MAX_QUESTION_SPEECH_BYTES) {
        await reader.cancel();
        throw new Error("QUESTION_TTS_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged.buffer;
}

interface QuestionAnswer {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
}

interface BorrowerInterviewRoomProps {
  interviewId: string;
  initialMode: InterviewMethod;
  autoStartQuestionVoice?: boolean;
  demoAvailable?: boolean;
}

function mergeQuestionAnswerHistory(
  serverHistory: readonly QuestionAnswer[],
  localHistory: readonly QuestionAnswer[],
): QuestionAnswer[] {
  // The server may preserve Claude's contextual lead-in while the borrower
  // heard the canonical catalog sentence. An answer match is therefore the
  // stable de-duplication key, and the authoritative server row wins.
  const serverAnswers = new Set(serverHistory.map((row) => row.answer.trim()));
  return [
    ...serverHistory,
    ...localHistory.filter(
      (row) => !serverAnswers.has(row.answer.trim()),
    ),
  ].slice(-30);
}

export function BorrowerInterviewRoom({ interviewId, initialMode, autoStartQuestionVoice = false, demoAvailable = false }: BorrowerInterviewRoomProps) {
  const [snapshot, setSnapshot] = useState<InterviewSnapshotView | null>(null);
  const [method, setMethod] = useState<InterviewMethod>(initialMode);
  const [demoRunning, setDemoRunning] = useState(false);
  const isScenario = snapshot?.businessName === OPERATING_DAY_DEMO_SCENARIO.persona.businessName
    && snapshot?.borrowerName === OPERATING_DAY_DEMO_SCENARIO.persona.borrowerName;
  function changeMethod(nextMethod: InterviewMethod) {
    const url = new URL(window.location.href);
    url.searchParams.set("mode", nextMethod);
    url.searchParams.delete("autoplay");
    window.history.replaceState(window.history.state, "", url);
    setMethod(nextMethod);
  }
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<QuestionAnswer[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [reviewDetailsOpen, setReviewDetailsOpen] = useState(true);
  const [reviewTab, setReviewTab] = useState<"answers" | "business">("answers");
  const [recentFeatureChanges, setRecentFeatureChanges] = useState<LiveFeaturePreviewChangeView[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speechPreparing, setSpeechPreparing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>("server");
  const [voiceListenSignal, setVoiceListenSignal] = useState(0);
  const [optimisticAnswer, setOptimisticAnswer] = useState<string | null>(null);
  const [audioUxState, setAudioUxState] = useState<string>("IDLE");
  // Browsers require a live user-activated playback context. Starting this as
  // true after a hard reload makes the first automatic play fail invisibly and
  // hides the only recovery button.
  const [voiceAutoplayEnabled, setVoiceAutoplayEnabled] = useState(false);
  const [realtimeVoiceFallback, setRealtimeVoiceFallback] = useState(false);
  const currentQuestionRef = useRef<string | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechObjectUrlRef = useRef<string | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const speechContextRef = useRef<AudioContext | null>(null);
  const speechSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const lastSpokenQuestionRef = useRef<string | null>(null);
  const speechRunIdRef = useRef(0);
  const timelineEndRef = useRef<HTMLDivElement | null>(null);
  const currentPhaseRef = useRef<HTMLLIElement | null>(null);
  const completionReviewRef = useRef<HTMLDivElement | null>(null);
  const initialAutoplayRecoveryAttemptedRef = useRef(false);

  const fetchSnapshot = useCallback(async () => {
    const response = await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}`, { cache: "no-store" });
    const data = await readApiEnvelope(response);
    const nextSnapshot = adaptInterviewSnapshot(data);
    return nextSnapshot;
  }, [interviewId]);

  const refresh = useCallback(async () => {
    const nextSnapshot = await fetchSnapshot();
    const previousFeatures = snapshot?.snapshotType === "PREVIEW" ? snapshot.features : [];
    const nextFeatures = nextSnapshot.snapshotType === "PREVIEW" ? nextSnapshot.features : [];
    const featureChanges = diffLiveFeatureSnapshots(previousFeatures, nextFeatures);
    if (featureChanges.length > 0) setRecentFeatureChanges(featureChanges.slice(-3));
    setSnapshot(nextSnapshot);
    realtimeLatencyTelemetry.markNextQuestionReady();
    setError(null);
  }, [fetchSnapshot, snapshot]);

  useEffect(() => {
    let active = true;
    fetchSnapshot()
      .then((nextSnapshot) => { if (active) setSnapshot(nextSnapshot); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "인터뷰를 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchSnapshot, interviewId]);

  useEffect(() => {
    // Realtime owns the first greeting and every following question. The old
    // Qwen autoplay recovery must stay dormant unless WebRTC explicitly falls
    // back, otherwise two independent interview voices start on the same page.
    if (initialMode === "voice" && !realtimeVoiceFallback) {
      initialAutoplayRecoveryAttemptedRef.current = true;
      return;
    }
    if (
      initialAutoplayRecoveryAttemptedRef.current ||
      initialMode !== "voice" ||
      !autoStartQuestionVoice
    ) {
      return;
    }
    initialAutoplayRecoveryAttemptedRef.current = true;
    const retainedVoiceContext = currentQuestionVoicePlayback();
    if (!retainedVoiceContext) return;
    speechContextRef.current = retainedVoiceContext;
    let active = true;
    const enableWhenRunning = () => {
      if (active && retainedVoiceContext.state === "running") {
        setVoiceAutoplayEnabled(true);
      }
    };
    enableWhenRunning();
    if (retainedVoiceContext.state !== "running") {
      void retainedVoiceContext.resume().then(enableWhenRunning).catch(() => {
        // A hard reload normally lands here. Keep autoplay disabled so the
        // borrower sees the explicit, gesture-backed start button.
      });
    }
    return () => { active = false; };
  }, [autoStartQuestionVoice, initialMode, realtimeVoiceFallback]);

  const live: LiveInterviewView | null = snapshot?.snapshotType === "PREVIEW" ? snapshot : null;
  const rawQuestion = live?.currentQuestion ?? null;
  const hasBorrowerResponse = live?.transcript.some((segment) => segment.speaker === "BORROWER") ?? false;
  const questionPresentation = presentedQuestion({
    infoCode: live?.currentQuestionInfoCode ?? null,
    questionReason: live?.questionReason ?? null,
    displayedQuestion: rawQuestion,
  });
  const question = questionPresentation.text;
  const promptToSpeak = question
    ? hasBorrowerResponse ? question : `${INTERVIEW_WELCOME} ${question}`
    : null;
  const turnBackchannel = TURN_BACKCHANNELS[history.length % TURN_BACKCHANNELS.length];
  const predictedNextQuestions = useMemo(
    () => live
      ? predictCanonicalNextQuestions(live.currentQuestionInfoCode, live.informationItems)
      : [],
    [live],
  );
  useEffect(() => {
    currentQuestionRef.current = question;
  }, [question]);

  const stopSpeaking = useCallback(() => {
    speechRunIdRef.current += 1;
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    try {
      speechSourceRef.current?.stop();
    } catch {
      // The buffer may have naturally ended between the click and this cleanup.
    }
    speechSourceRef.current = null;
    const audio = speechAudioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    speechAudioRef.current = null;
    if (speechObjectUrlRef.current) URL.revokeObjectURL(speechObjectUrlRef.current);
    speechObjectUrlRef.current = null;
    window.speechSynthesis?.cancel();
    setSpeechPreparing(false);
    setSpeaking(false);
  }, []);

  const unlockQuestionVoice = useCallback(() => {
    const context = speechContextRef.current ?? unlockQuestionVoicePlayback();
    if (!context) return;
    speechContextRef.current = context;
    void context.resume();
  }, []);

  const speakWithDeviceVoice = useCallback((
    text: string,
    continueConversation = false,
    runId = speechRunIdRef.current,
  ) => {
    const failDeviceVoice = () => {
      if (runId !== speechRunIdRef.current) return;
      setSpeechPreparing(false);
      setSpeaking(false);
      setVoiceAutoplayEnabled(false);
      setError("AI 음성 재생을 시작하지 못했습니다. '음성 대화 시작'을 눌러 다시 시도하거나 질문을 화면에서 확인해 주세요.");
    };
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      failDeviceVoice();
      return;
    }
    const telemetryToken = realtimeLatencyTelemetry.beginTtsRequest("device");
    try {
      const voices = window.speechSynthesis.getVoices();
      const koreanVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("ko"));
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = "ko-KR";
      utterance.rate = 0.94;
      if (koreanVoice) utterance.voice = koreanVoice;
      utterance.onstart = () => {
        realtimeLatencyTelemetry.markTtsPlaybackStarted(telemetryToken, {
          provider: "device",
          fallback: true,
        });
      };
      utterance.onend = () => {
        if (runId !== speechRunIdRef.current) return;
        setSpeaking(false);
        if (continueConversation) setVoiceListenSignal((value) => value + 1);
      };
      utterance.onerror = failDeviceVoice;
      setSpeechPreparing(false);
      setSpeaking(true);
      setVoiceProvider("device");
      realtimeLatencyTelemetry.markTtsFirstByte(telemetryToken, "device");
      window.speechSynthesis.speak(utterance);
    } catch {
      failDeviceVoice();
    }
  }, []);

  const speakQuestion = useCallback(async (
    questionToSpeak = promptToSpeak,
    options: { continueConversation?: boolean } = {},
  ) => {
    if (!questionToSpeak || typeof window === "undefined") return;
    stopSpeaking();
    const runId = speechRunIdRef.current + 1;
    speechRunIdRef.current = runId;
    setError(null);
    setSpeechPreparing(true);
    const controller = new AbortController();
    speechAbortRef.current = controller;
    try {
      const context = speechContextRef.current ?? currentQuestionVoicePlayback();
      if (context) speechContextRef.current = context;
      if (context?.state === "suspended") {
        await context.resume().catch(() => undefined);
      }
      const chunks = splitQuestionForSpeech(questionToSpeak);
      if (chunks.length === 0) return;
      let prefetchPromise: Promise<void> | null = null;
      const telemetryToken = realtimeLatencyTelemetry.beginTtsRequest("server");
      const requestVoiceChunk = async (chunk: string, signal?: AbortSignal) => {
        const response = await authenticatedFetch(QUESTION_SPEECH_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: chunk, interviewId }),
          signal,
        });
        if (!response.ok) throw new Error("QUESTION_TTS_UNAVAILABLE");
        const providerHeader = response.headers.get("x-speech-provider");
        const provider = providerHeader === "openai" || providerHeader === "qwen" ? providerHeader : "server";
        const bytes = await readSpeechResponse(response, () => {
          if (chunk === chunks[0]) {
            realtimeLatencyTelemetry.markTtsFirstByte(telemetryToken, provider);
          }
        });
        if (!bytes.byteLength) throw new Error("QUESTION_TTS_EMPTY");
        return { bytes, contentType: response.headers.get("content-type") ?? "audio/wav", provider: provider as "qwen" | "openai" | "server" };
      };
      const loadChunk = (chunk: string) => cachedQuestionVoiceChunk(
        chunk,
        () => requestVoiceChunk(chunk, controller.signal),
        interviewId,
      );
      let pending = loadChunk(chunks[0]);
      for (let index = 0; index < chunks.length; index += 1) {
        const voice = await pending;
        if (index === 0) {
          // A memory/disk cache hit never opens a response stream, so the
          // resolved cached bytes are its first-byte boundary.
          realtimeLatencyTelemetry.markTtsFirstByte(telemetryToken, voice.provider ?? "server");
        }
        if (controller.signal.aborted || runId !== speechRunIdRef.current) return;
        const nextPending = index + 1 < chunks.length ? loadChunk(chunks[index + 1]) : null;
        if (
          index === chunks.length - 1 &&
          options.continueConversation &&
          questionToSpeak === promptToSpeak
        ) {
          // The acknowledgement has queue priority. Once it is ready, warm
          // only the likely next question's first chunk while the borrower is
          // answering. Predictions never reach the transcript or playback.
          prefetchPromise = (async () => {
            await prefetchQuestionVoiceFirstChunks([turnBackchannel], requestVoiceChunk, 1, interviewId);
            if (!controller.signal.aborted) {
              await prefetchQuestionVoiceFirstChunks(predictedNextQuestions, requestVoiceChunk, 1, interviewId);
            }
          })();
          void prefetchPromise.catch(() => undefined);
        }
        setVoiceProvider(voice.provider ?? "server");
        setSpeechPreparing(false);
        setSpeaking(true);
        if (context?.state === "running") {
          const buffer = await context.decodeAudioData(voice.bytes.slice(0));
          if (controller.signal.aborted || runId !== speechRunIdRef.current) return;
          await new Promise<void>((resolve) => {
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.connect(context.destination);
            speechSourceRef.current = source;
            source.onended = () => {
              if (speechSourceRef.current === source) speechSourceRef.current = null;
              resolve();
            };
            source.start();
            if (index === 0) {
              realtimeLatencyTelemetry.markTtsPlaybackStarted(telemetryToken, {
                provider: voice.provider ?? "server",
                fallback: false,
              });
            }
          });
        } else {
          const objectUrl = URL.createObjectURL(new Blob([voice.bytes], { type: voice.contentType }));
          const audio = new Audio(objectUrl);
          audio.preload = "auto";
          audio.volume = 1;
          speechObjectUrlRef.current = objectUrl;
          speechAudioRef.current = audio;
          await new Promise<void>((resolve, reject) => {
            audio.onended = () => resolve();
            audio.onerror = () => reject(new Error("QUESTION_TTS_PLAYBACK_FAILED"));
            void audio.play().then(() => {
              if (index === 0) {
                realtimeLatencyTelemetry.markTtsPlaybackStarted(telemetryToken, {
                  provider: voice.provider ?? "server",
                  fallback: false,
                });
              }
            }).catch(reject);
          });
          if (speechAudioRef.current === audio) speechAudioRef.current = null;
          if (speechObjectUrlRef.current === objectUrl) speechObjectUrlRef.current = null;
          URL.revokeObjectURL(objectUrl);
        }
        if (nextPending) pending = nextPending;
      }
      if (runId !== speechRunIdRef.current) return;
      setSpeaking(false);
      if (prefetchPromise) {
        void prefetchPromise.finally(() => {
          if (speechAbortRef.current === controller) speechAbortRef.current = null;
        });
      } else if (speechAbortRef.current === controller) {
        speechAbortRef.current = null;
      }
      if (options.continueConversation && !controller.signal.aborted) {
        setVoiceListenSignal((value) => value + 1);
      }
    } catch {
      if (controller.signal.aborted || runId !== speechRunIdRef.current) return;
      stopSpeaking();
      const fallbackRunId = speechRunIdRef.current + 1;
      speechRunIdRef.current = fallbackRunId;
      // A local Qwen service can be intentionally stopped. Device TTS keeps
      // the borrower flow audible without ever fabricating an interview answer.
      speakWithDeviceVoice(questionToSpeak, options.continueConversation, fallbackRunId);
    }
  }, [interviewId, predictedNextQuestions, promptToSpeak, speakWithDeviceVoice, stopSpeaking, turnBackchannel]);

  const startVoiceConversation = useCallback(() => {
    if (!promptToSpeak) return;
    unlockQuestionVoice();
    setVoiceAutoplayEnabled(true);
    lastSpokenQuestionRef.current = promptToSpeak;
    void speakQuestion(promptToSpeak, { continueConversation: true });
  }, [promptToSpeak, speakQuestion, unlockQuestionVoice]);

  const interruptQuestionAndListen = useCallback(() => {
    stopSpeaking();
    setVoiceListenSignal((value) => value + 1);
  }, [stopSpeaking]);

  useEffect(() => {
    if (method === "voice" && !realtimeVoiceFallback) return;
    if (!shouldAutoPlayQuestionVoice({
      method,
      voiceAutoplayEnabled,
      promptToSpeak,
      speaking,
      speechPreparing,
      voiceBusy,
      lastSpokenQuestion: lastSpokenQuestionRef.current,
    })) return;
    lastSpokenQuestionRef.current = promptToSpeak;
    void speakQuestion(promptToSpeak, { continueConversation: true });
  }, [method, promptToSpeak, realtimeVoiceFallback, speakQuestion, speaking, speechPreparing, voiceAutoplayEnabled, voiceBusy]);

  useEffect(() => () => {
    stopSpeaking();
    releaseQuestionVoicePlayback(speechContextRef.current);
    speechContextRef.current = null;
  }, [stopSpeaking]);

  const addQuestionAnswer = useCallback((questionText: string, answerText: string) => {
    const row: QuestionAnswer = { id: createClientCommandId("qa"), question: questionText, answer: answerText, createdAt: new Date().toISOString() };
    setHistory((previous) => [...previous, row].slice(-30));
    setSelectedHistoryId(row.id);
  }, []);

  async function submitAnswer(
    text: string,
    retryCommand: PendingMessageCommandView | null = null,
  ) {
    const trimmed = text.trim();
    if (!trimmed || sending || !live || (!question && !retryCommand)) return;
    if (
      retryCommand &&
      (retryCommand.processingState !== "READY" ||
        live.pendingCommand?.clientMessageId !== retryCommand.clientMessageId)
    ) {
      setError("저장된 답변의 최신 상태가 바뀌었습니다. 상태를 다시 확인해 주세요.");
      return;
    }
    const command: PendingMessageCommandView = retryCommand ?? {
      text: trimmed,
      clientMessageId: createClientCommandId("borrower-message"),
      expectedVersion: live.version,
      currentQuestionInfoCode: live.currentQuestionInfoCode,
      transcriptMetadata: null,
      processingState: "READY",
    };
    const isRetry = retryCommand !== null;
    setSending(true);
    setError(null);
    if (!isRetry) setOptimisticAnswer(trimmed);
    stopSpeaking();
    const answeredQuestion = isRetry ? null : question;
    try {
      const response = await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(borrowerMessageCommandPayload(command)),
      });
      const data = await readApiEnvelope(response);
      const processing = extractMessageProcessingTelemetry(data);
      const nextSnapshot = adaptInterviewSnapshot(data);
      setSnapshot(nextSnapshot);
      if (answeredQuestion) {
        addQuestionAnswer(answeredQuestion, trimmed);
        setAnswer("");
        setOptimisticAnswer(null);
      }
      if (processing?.status === "APPLIED") setError(null);
      if (processing?.status === "RETRYABLE_FAILURE") setError("답변은 안전하게 저장됐어요. 아래의 '같은 답변 다시 정리'를 눌러 중복 없이 다시 처리할 수 있어요.");
      if (processing?.status === "NON_RETRYABLE_FAILURE") setError("답변은 저장됐어요. 지금은 AI 정리를 적용할 수 없어 담당자가 확인합니다.");
      if (!processing) setError("답변 처리 결과를 확인하지 못했습니다. 상태를 다시 확인해 주세요.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "답변을 전송하지 못했습니다. 입력 내용은 그대로 남아 있습니다.");
    } finally {
      setSending(false);
    }
  }

  const transcriptMessages = useMemo(() => live?.transcript ?? [], [live?.transcript]);
  const reconstructedHistory = useMemo(
    () => reconstructQuestionAnswerHistory(transcriptMessages),
    [transcriptMessages],
  );
  const reviewHistory = useMemo(
    () => mergeQuestionAnswerHistory(reconstructedHistory, history),
    [history, reconstructedHistory],
  );
  const selectedHistory = useMemo(
    () => reviewHistory.find((row) => row.id === selectedHistoryId) ?? reviewHistory.at(-1) ?? null,
    [reviewHistory, selectedHistoryId],
  );
  const latestAssistantMessage = [...transcriptMessages]
    .reverse()
    .find((segment) => segment.speaker === "ASSISTANT") ?? null;
  const pendingCommand = live?.pendingCommand ?? null;
  const responseDisabled = !live || sending || voiceBusy || !question || live.pendingCommand !== null;
  // The voice control owns LISTENING/AI_SPEAKING transitions. Feeding its own
  // busy signal back as `disabled` would also disable the explicit barge-in
  // button while AI speech is active.
  const voiceControlDisabled = !live || sending || !question || live.pendingCommand !== null;
  const currentInformationItem = live?.informationItems.find(
    (item) => item.infoCode === live.currentQuestionInfoCode,
  ) ?? null;

  // 주소에 ?demo=... 가 있을 때만 대본을 자동으로 넣는다. 없으면 기존 동작 그대로다.
  useDemoAutoplay({
    enabled: isScenario && demoAvailable && method === "chat" && demoRunning,
    currentQuestionInfoCode: live?.currentQuestionInfoCode ?? null,
    ready: !responseDisabled,
    submitAnswer: (text) => void submitAnswer(text),
  });
  const borrowerExperience = useMemo(
    () => buildBorrowerExperience({
      informationItems: live?.informationItems ?? [],
      features: live?.features ?? [],
      evidence: live?.evidence ?? [],
      currentQuestionInfoCode: live?.currentQuestionInfoCode ?? null,
      questionReason: live?.questionReason ?? null,
      goal: live?.goal ?? null,
    }),
    [
      live?.goal,
      live?.informationItems,
      live?.features,
      live?.evidence,
      live?.currentQuestionInfoCode,
      live?.questionReason,
    ],
  );
  const conversationGuide = useMemo(
    () => buildBorrowerConversationGuide({
      informationItems: live?.informationItems ?? [],
      currentQuestionInfoCode: live?.currentQuestionInfoCode ?? null,
    }),
    [live?.informationItems, live?.currentQuestionInfoCode],
  );
  const scenarioPrompt = useMemo(
    () => buildGroundedScenarioPrompt({
      informationItems: live?.informationItems ?? [],
      currentQuestionInfoCode: live?.currentQuestionInfoCode ?? null,
      questionReason: live?.questionReason ?? null,
    }),
    [live?.informationItems, live?.currentQuestionInfoCode, live?.questionReason],
  );
  const curiosityCard = useMemo(
    () => buildEvidenceCuriosityCard({
      informationItems: live?.informationItems ?? [],
      currentQuestionInfoCode: live?.currentQuestionInfoCode ?? null,
      displayedQuestion: question,
    }),
    [live?.informationItems, live?.currentQuestionInfoCode, question],
  );
  const isTurnProcessing = sending || ["TRANSCRIBING", "AI_THINKING"].includes(audioUxState);
  const completionReviewAvailable = canOfferBorrowerCompletion({
    hasLiveSnapshot: live !== null,
    currentQuestion: question,
    hasPendingCommand: live?.pendingCommand !== null && live?.pendingCommand !== undefined,
    hasBlockingError: error !== null,
    isTurnProcessing,
    isVoiceBusy: voiceBusy || speaking || speechPreparing,
    isSending: sending,
  });
  const borrowerAnswerCount = transcriptMessages.filter(
    (message) => message.speaker === "BORROWER",
  ).length;
  const conversationStatus = completionReviewAvailable
    ? "마지막 내용을 함께 확인해요"
    : speechPreparing
      ? "다음 말을 준비하고 있어요"
      : speaking
        ? "동행 AI가 이야기하고 있어요"
        : audioUxState === "LISTENING"
          ? "사장님 말씀을 듣고 있어요"
          : audioUxState === "TRANSCRIBING"
            ? "말씀을 글로 옮기고 있어요"
            : audioUxState === "AI_THINKING" || sending
              ? "답변을 이해하고 다음 질문을 준비해요"
              : method === "voice" && voiceAutoplayEnabled
                ? "편하게 말씀해 주세요"
                : "사장님 답변을 기다리고 있어요";

  useEffect(() => {
    const timeline = timelineEndRef.current?.parentElement;
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    timeline?.scrollTo({ top: timeline.scrollHeight, behavior });
  }, [optimisticAnswer, question, sending, transcriptMessages.length]);

  useEffect(() => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ? "auto"
      : "smooth";
    const phase = currentPhaseRef.current;
    const track = phase?.parentElement;
    if (phase && track) track.scrollTo({ left: phase.offsetLeft - track.offsetLeft - (track.clientWidth - phase.clientWidth) / 2, behavior });
  }, [conversationGuide.currentPhaseKey]);

  useEffect(() => {
    if (!completionReviewAvailable) return;
    const frame = window.requestAnimationFrame(() => {
      const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth";
      completionReviewRef.current?.scrollIntoView({ behavior, block: "start" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [completionReviewAvailable]);

  if (loading) return <main id="main-content" className="borrower-room borrower-room--loading"><LoaderCircle className="spin" size={30} /> 인터뷰를 준비하고 있어요.</main>;
  if (!snapshot || error && !live) return <main id="main-content" className="borrower-room borrower-room--loading"><p>{error ?? "인터뷰를 불러오지 못했습니다."}</p><button type="button" className="borrower-secondary-button" onClick={() => void refresh()}>다시 불러오기</button></main>;
  if (snapshot.snapshotType === "FINAL") return <BorrowerResult snapshot={snapshot} />;

  return (
    <main id="main-content" className={`borrower-room borrower-room--${method}`}>
      <header className="borrower-room__header">
        <div>
          <span className="borrower-room__step">{isScenario ? "합성 시연 · 답변에서 평가까지" : "동행금융 · 사업 현황 입력"}</span>
          <h1>{snapshot.businessName} 이야기</h1>
          <p>모르거나 답하기 어려운 내용은 넘어가셔도 됩니다.</p>
        </div>
        <div className="borrower-room__progress" aria-label={conversationGuide.ariaLabel}>
          <strong>{conversationGuide.currentStep}/{conversationGuide.totalSteps}</strong>
          <small>현재 단계</small>
          <span><i style={{ width: `${(conversationGuide.currentStep / conversationGuide.totalSteps) * 100}%` }} /></span>
        </div>
      </header>
      {isScenario && demoAvailable && <section className="demo-scenario-controls" aria-label="합성 시연 대본 입력"><div><strong>등록된 대본으로 변수와 점수 연결 확인</strong><p>자동 입력을 누르면 가상 답변이 기록됩니다. 직접 입력하거나 중간에 멈출 수 있습니다.</p></div><button type="button" className="borrower-secondary-button" disabled={!demoRunning && (responseDisabled || method !== "chat")} onClick={() => setDemoRunning((running) => !running)}>{demoRunning ? "자동 입력 일시정지" : "대본 자동 입력"}</button></section>}
      <nav className="borrower-phase-guide" aria-label={conversationGuide.ariaLabel}>
        <ol>
          {conversationGuide.phases.map((phase, index) => (
            <li
              key={phase.key}
              ref={phase.state === "CURRENT" ? currentPhaseRef : undefined}
              data-state={phase.state.toLowerCase()}
              aria-current={phase.state === "CURRENT" ? "step" : undefined}
            >
              <span aria-hidden="true">{phase.state === "DONE" ? "✓" : index + 1}</span>
              <div>
                <strong>{phase.label}</strong>
                <small>{phase.state === "CURRENT" ? phase.stateLabel : phase.description}</small>
              </div>
            </li>
          ))}
        </ol>
      </nav>
      <div className="borrower-room__layout">
        <section className="borrower-conversation" aria-label="AI와 사장님의 대화">
          <div className="borrower-conversation__mode">
            <button type="button" aria-pressed={method === "chat"} data-active={method === "chat"} onClick={() => { stopSpeaking(); setVoiceAutoplayEnabled(false); setVoiceBusy(false); setAudioUxState("IDLE"); changeMethod("chat"); }}><MessageCircle size={16} /> 채팅 답변</button>
            <button type="button" aria-pressed={method === "voice"} data-active={method === "voice"} onClick={() => { stopSpeaking(); setVoiceAutoplayEnabled(false); setRealtimeVoiceFallback(false); changeMethod("voice"); }}><Mic size={16} /> 음성 답변</button>
            {(method === "chat" || realtimeVoiceFallback) && <small className="borrower-neural-voice-status" data-provider={voiceProvider}>
              {speechPreparing
                ? "AI 음성을 준비하고 있어요"
                : speaking
                  ? voiceProvider === "device" ? "기기 음성으로 질문을 안내 중" : "AI 질문을 음성으로 안내 중"
                  : voiceAutoplayEnabled
                    ? "다음 AI 질문도 음성으로 안내합니다"
                    : "질문 듣기를 눌러 음성을 재생하세요"}
            </small>}
          </div>
          {method === "chat" && <>
          <section className="borrower-live-presence" data-state={audioUxState.toLowerCase()} role="status" aria-live="polite">
            <div><span>{currentInformationItem?.categoryLabel ?? "지금 이야기"}</span><strong>{conversationStatus}</strong></div>
          </section>
          <div className="borrower-conversation__timeline" role="log" aria-label="인터뷰 대화 기록" aria-live="polite">
            {!hasBorrowerResponse && (
              <div className="borrower-welcome" role="note">
                <strong>안녕하세요, 사장님.</strong>
                <p>편하게 말씀해 주세요. 한 번에 하나씩 여쭤볼게요.</p>
              </div>
            )}
            {transcriptMessages.map((message) => message.speaker === "ASSISTANT" ? (
              <article className="borrower-message borrower-message--ai" data-current={message.id === latestAssistantMessage?.id} key={message.id}>
                <div className="borrower-message__meta">
                  <span>동행 AI</span>
                  {message.id === latestAssistantMessage?.id && question && (
                    <button type="button" onClick={speaking || speechPreparing ? stopSpeaking : () => { unlockQuestionVoice(); lastSpokenQuestionRef.current = promptToSpeak; void speakQuestion(question); }}>
                      {speechPreparing ? "음성 준비 취소" : speaking ? "읽기 멈춤" : "다시 듣기"} <Volume2 size={15} />
                    </button>
                  )}
                </div>
                {message.id === latestAssistantMessage?.id && questionPresentation.context && (
                  <p className="borrower-message__reaction">
                    <span>{questionPresentation.context}</span>
                  </p>
                )}
                <p>{message.id === latestAssistantMessage?.id && question ? question : message.text}</p>
              </article>
            ) : (
              <article className="borrower-message borrower-message--owner" key={message.id}>
                <span>사장님 답변</span><p>{message.text}</p>
              </article>
            ))}
            {transcriptMessages.length === 0 && (
              <article className="borrower-message borrower-message--ai"><span>동행 AI</span><p>{question ?? "인터뷰를 준비하고 있어요."}</p></article>
            )}
            {optimisticAnswer && !transcriptMessages.some((message) => message.speaker === "BORROWER" && message.text === optimisticAnswer) && (
              <article className="borrower-message borrower-message--owner borrower-message--optimistic">
                <span>사장님 답변 · 들었어요</span><p>{optimisticAnswer}</p>
              </article>
            )}
            {isTurnProcessing && (
              <article className="borrower-message borrower-message--thinking" role="status">
                <div className="borrower-thinking-dots" aria-hidden="true"><i /><i /><i /></div>
                <p>{audioUxState === "TRANSCRIBING" ? "말씀을 정확히 옮기고 있어요." : "답변의 맥락을 정리하고 다음 질문을 준비하고 있어요."}</p>
              </article>
            )}
            <div ref={timelineEndRef} className="borrower-timeline-end" aria-hidden="true" />
          </div>
          </>}
          {pendingCommand && (
            <section className="borrower-pending-retry" role="alert" aria-live="assertive">
              <div>
                <strong>
                  {pendingCommand.processingState === "PROCESSING"
                    ? "저장된 답변을 AI가 정리하고 있어요"
                    : "저장된 답변의 AI 정리가 필요해요"}
                </strong>
                <p>사장님의 답변은 이미 안전하게 저장됐습니다. 새 답변으로 보내지 않고 같은 기록을 이어서 처리합니다.</p>
              </div>
              <blockquote>{pendingCommand.text}</blockquote>
              <div className="borrower-pending-retry__actions">
                <button type="button" className="borrower-secondary-button" onClick={() => void refresh()} disabled={sending}>
                  <RefreshCw size={14} /> 상태 확인
                </button>
                <button
                  type="button"
                  className="borrower-primary-button"
                  disabled={sending || pendingCommand.processingState !== "READY"}
                  onClick={() => void submitAnswer(pendingCommand.text, pendingCommand)}
                >
                  {sending ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}
                  {pendingCommand.processingState === "PROCESSING" ? "정리 진행 중" : "같은 답변 다시 정리"}
                </button>
              </div>
            </section>
          )}
          {completionReviewAvailable && live ? (
            <div ref={completionReviewRef} className="borrower-completion-review-shell">
              <BorrowerCompletionReview
                interviewId={interviewId}
                live={live}
                answerCount={borrowerAnswerCount}
                onCompleted={setSnapshot}
                onRefresh={refresh}
              />
            </div>
          ) : question ? (
            <>
          {method === "chat" && <>
          {curiosityCard && (
            <section className="borrower-curiosity-card" role="note" aria-labelledby="borrower-curiosity-card-title">
              <div>
                <strong id="borrower-curiosity-card-title">{curiosityCard.label}</strong>
                <p>{curiosityCard.context}</p>
                <small>답하기 어려우면 건너뛸 수 있고, 확인되지 않은 사실로 저장하지 않아요.</small>
              </div>
            </section>
          )}
          {scenarioPrompt && (
            <details className="borrower-scenario-prompt" aria-labelledby="borrower-scenario-title">
              <summary id="borrower-scenario-title">생각을 돕는 예시 보기</summary>
              <div>
                <span>{scenarioPrompt.label}</span>
                <strong>{scenarioPrompt.question}</strong>
                <small>{scenarioPrompt.notice}</small>
              </div>
              <button
                type="button"
              disabled={responseDisabled}
              onClick={() => {
                  if (method === "chat") {
                    document.querySelector<HTMLTextAreaElement>("#borrower-answer")?.focus();
                  } else {
                    setVoiceListenSignal((value) => value + 1);
                  }
                }}
              >
                {method === "chat" ? "이 질문을 참고해 답하기" : "말로 답해 볼게요"}
              </button>
            </details>
          )}
          {borrowerExperience.quickChoices.length > 0 && (
            <section className="borrower-quick-choices" aria-labelledby="borrower-quick-choice-title">
              <div>
                <strong id="borrower-quick-choice-title">
                  {borrowerExperience.questionPresentation.tone === "FOLLOWUP"
                    ? "아는 만큼 답하거나 바로 넘어갈 수 있어요"
                    : borrowerExperience.questionPresentation.tone === "OPTIONAL"
                      ? "선택해서 답하거나 건너뛸 수 있어요"
                      : "먼저 가까운 답을 골라도 좋아요"}
                </strong>
                <span>
                  {borrowerExperience.questionPresentation.tone === "FOLLOWUP"
                    ? "이번 확인 뒤에는 같은 내용을 반복해 묻지 않아요."
                    : borrowerExperience.questionPresentation.tone === "OPTIONAL"
                      ? "건너뛰어도 인터뷰는 다음 이야기로 계속됩니다."
                      : "고른 문장이 사장님 답변으로 그대로 저장되고, 이어서 구체적으로 여쭤볼게요."}
                </span>
              </div>
              <div className="borrower-quick-choices__buttons">
                {borrowerExperience.quickChoices.map((choice) => (
                  <button
                    type="button"
                    key={choice.id}
                    disabled={responseDisabled}
                    onClick={() => void submitAnswer(choice.statement)}
                  >
                    {choice.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          </>}
          {method === "chat" ? (
            <form className="borrower-answer-box" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submitAnswer(answer); }}>
              <label htmlFor="borrower-answer">사장님의 답변</label>
              <textarea id="borrower-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void submitAnswer(answer); } }} rows={2} maxLength={3000} disabled={responseDisabled} placeholder="정해진 답은 없어요. 사장님이 겪은 그대로 말씀해 주세요." />
              <div><small>Enter 전송 · Shift+Enter 줄바꿈</small><button className="borrower-primary-button" type="submit" disabled={responseDisabled || !answer.trim()}>{sending ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />} 답변 보내기</button></div>
            </form>
          ) : (
            <div className={`borrower-voice-box ${realtimeVoiceFallback ? "borrower-voice-box--fallback" : "borrower-voice-box--realtime"}`}>
              {realtimeVoiceFallback ? (
                <>
                  <div>
                    <strong>한 문장씩 듣고 답합니다</strong>
                    <p>질문을 들은 뒤 마이크로 답해 주세요. 말을 마치면 전사한 답변을 저장합니다.</p>
                  </div>
                  <div className="borrower-voice-fallback-note" role="status">
                    문장 단위 음성 방식입니다. 실시간 통화로 돌아가려면 위의 음성 답변을 눌러 주세요.
                  </div>
                  <RealtimeLatencyStatus />
                  {!voiceAutoplayEnabled && (
                    <button type="button" className="borrower-voice-start" onClick={startVoiceConversation} disabled={!question || responseDisabled}>
                      <Volume2 size={17} /> 질문 듣고 답하기
                    </button>
                  )}
                  <AudioInterviewControls
                    interviewId={interviewId}
                    currentQuestion={question}
                    disabled={voiceControlDisabled}
                    borrowerMode
                    showQuestionVoiceControl={false}
                    autoStartSignal={voiceListenSignal}
                    externalQuestionVoiceActive={speechPreparing || speaking}
                    onQuestionVoiceInterrupt={interruptQuestionAndListen}
                    onBusyChange={setVoiceBusy}
                    onRecognizedTranscript={(text) => {
                      setOptimisticAnswer(text);
                      unlockQuestionVoice();
                      void speakQuestion(turnBackchannel);
                    }}
                    onServerFinal={async (text) => {
                      if (currentQuestionRef.current) addQuestionAnswer(currentQuestionRef.current, text);
                      await refresh();
                      setOptimisticAnswer(null);
                    }}
                    onStatusChange={(status) => setAudioUxState(status.uxState)}
                  />
                </>
              ) : (
                <RealtimeVoiceInterview
                  interviewId={interviewId}
                  currentQuestion={question}
                  questionKey={`${live?.version ?? 0}:${live?.currentQuestionInfoCode ?? "complete"}`}
                  disabled={voiceControlDisabled}
                  onBusyChange={setVoiceBusy}
                  onStatusChange={(status) => setAudioUxState(status.uxState)}
                  onFinalTranscript={async (text) => {
                    await submitAnswer(text);
                  }}
                  onUnavailable={() => {
                    setVoiceBusy(false);
                    setRealtimeVoiceFallback(true);
                    setError(null);
                    setVoiceAutoplayEnabled(false);
                  }}
                />
              )}
            </div>
          )}
            </>
          ) : (
            <section className="borrower-completion-wait" role="status" aria-live="polite">
              {!error && <LoaderCircle className="spin" size={22} aria-hidden="true" />}
              <div>
                <strong>{error ? "다음 단계를 확인하지 못했어요" : "마지막 답변을 안전하게 정리하고 있어요"}</strong>
                <p>{error ? "최신 상태를 불러온 뒤 질문을 이어가거나 완료 확인으로 이동할 수 있어요." : "처리가 끝나기 전에는 인터뷰 완료 버튼을 보여드리지 않습니다."}</p>
              </div>
              {error && <button type="button" className="borrower-secondary-button" onClick={() => void refresh()}><RefreshCw size={14} /> 다시 확인</button>}
            </section>
          )}
          {error && <div className="borrower-room__error" role="alert">{error}<button type="button" onClick={() => void refresh()}><RefreshCw size={14} /> 상태 새로고침</button></div>}
        </section>
        <aside className="borrower-review" aria-label="내 질문과 답변 확인">
          <div className="borrower-review-tabs" role="group" aria-label="내 이야기 살펴보기">
            <button type="button" aria-pressed={reviewTab === "answers"} onClick={() => setReviewTab("answers")}>질문·답변 <span>{reviewHistory.length}</span></button>
            <button type="button" aria-pressed={reviewTab === "business"} onClick={() => setReviewTab("business")}>사업 지도</button>
          </div>
          {reviewTab === "business" && <>
          <section className="borrower-business-map" aria-labelledby="borrower-business-map-title">
            <div className="borrower-business-map__heading">
              <div>
                <h2 id="borrower-business-map-title">사업 지도</h2>
              </div>
            </div>
            <p className="borrower-business-map__notice">어떤 이야기를 나눴는지 보여줍니다. 사업 평가 점수가 아닙니다.</p>
            <div className="borrower-business-route" role="list" aria-label="여섯 이야기 정류장의 정리 현황">
              {borrowerExperience.axes.map((axis, index) => (
                <div key={axis.key} data-state={axis.stateLabel} role="listitem">
                  <span className="borrower-business-route__marker" aria-hidden="true">{index + 1}</span>
                  <span className="borrower-business-route__line" aria-hidden="true" />
                  <div>
                    <strong>{axis.label}</strong>
                    <small>{axis.stateLabel}</small>
                  </div>
                </div>
              ))}
            </div>
          </section>
          <section className="borrower-grounded-insight" aria-live="polite">
            <span>답변에서 확인한 내용</span>
            {borrowerExperience.insight ? (
              <>
                <strong>{borrowerExperience.insight.text}</strong>
                <p>확인된 답변과 그 답변으로 계산한 값입니다.</p>
              </>
            ) : (
              <p>아직 확인된 답변이 없습니다.</p>
            )}
          </section>
          {recentFeatureChanges.length > 0 && (
            <section className="borrower-feature-feedback" aria-live="polite" aria-labelledby="borrower-feature-feedback-title">
              <span>방금 반영된 분석 변수</span>
              <h2 id="borrower-feature-feedback-title">말씀하신 내용이 이렇게 정리됐어요.</h2>
              <ul>
                {recentFeatureChanges.map((change) => (
                  <li key={change.name}>
                    <b aria-hidden="true">+</b>
                    <code>{change.name}</code>
                    <strong>{change.currentRaw ?? (change.currentNormalized !== null ? String(change.currentNormalized) : change.currentState)}</strong>
                  </li>
                ))}
              </ul>
              <p>이름과 값은 서버가 확정한 결과만 보여드립니다. 전체 모델링 Feature는 인터뷰 분석 화면에서 별도로 확인합니다.</p>
            </section>
          )}
          <section className="borrower-improvement-board" aria-labelledby="borrower-improvement-board-title">
            <div>
              <h2 id="borrower-improvement-board-title">가게 현황</h2>
            </div>
            <ol>
              {borrowerExperience.improvementBoard.map((lane) => (
                <li key={lane.key} data-filled={Boolean(lane.value)}>
                  <span>{lane.label}</span>
                  <strong>{lane.value ?? "아직 확인하지 않았습니다"}</strong>
                  {lane.sourceLabel && <small>{lane.sourceLabel}</small>}
                </li>
              ))}
            </ol>
          </section>
          </>}
          {reviewTab === "answers" && <>
          <div className="borrower-review__heading"><div><h2>지나온 질문·답변</h2></div><strong>{reviewHistory.length}개</strong></div>
          {reviewHistory.length === 0 ? <div className="borrower-review__empty">첫 답변을 보내면 이곳에서 질문과 답변을 다시 확인할 수 있어요.</div> : <div className="borrower-review__list">{reviewHistory.map((row, index) => <button type="button" key={row.id} aria-pressed={selectedHistory?.id === row.id} data-active={selectedHistory?.id === row.id} onClick={() => { setSelectedHistoryId(row.id); setReviewDetailsOpen(true); }}><span>질문 {index + 1}</span><strong>{row.question}</strong><ChevronRight size={16} /></button>)}</div>}
          {selectedHistory && <section className="borrower-review__detail"><button type="button" className="borrower-review__detail-title" aria-expanded={reviewDetailsOpen} aria-controls="borrower-selected-answer" onClick={() => setReviewDetailsOpen((open) => !open)}><span>선택한 질문과 답변</span><ChevronDown size={16} /></button><div id="borrower-selected-answer" hidden={!reviewDetailsOpen}><dl><div><dt>AI 질문</dt><dd>{selectedHistory.question}</dd></div><div><dt>사장님 답변</dt><dd>{selectedHistory.answer}</dd></div></dl><p>말씀하신 내용이 다르면 채팅으로 알려 주세요. 다음 질문에 반영됩니다.</p></div></section>}
          </>}
        </aside>
      </div>
    </main>
  );
}
