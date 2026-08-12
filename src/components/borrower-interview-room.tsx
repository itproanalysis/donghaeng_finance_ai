"use client";

import { CheckCircle2, ChevronDown, ChevronRight, LoaderCircle, MessageCircle, Mic, RefreshCw, Send, Volume2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { AudioInterviewControls } from "@/components/audio-interview-controls";
import {
  currentQuestionVoicePlayback,
  releaseQuestionVoicePlayback,
  unlockQuestionVoicePlayback,
} from "@/components/question-voice-playback";
import {
  adaptInterviewSnapshot,
  authenticatedFetch,
  createClientCommandId,
  extractMessageProcessingTelemetry,
  formatPercent,
  readApiEnvelope,
  type InterviewSnapshotView,
  type LiveInterviewView,
} from "@/components/api-adapter";

type InterviewMethod = "chat" | "voice";
type VoiceProvider = "qwen" | "device";

const QUESTION_SPEECH_ENDPOINT = "/api/voice/speech";
const INTERVIEW_WELCOME = "안녕하세요, 사장님. 정답을 찾는 자리가 아니라 사장님 사업 이야기를 듣는 시간이에요. 편하게 말씀해 주세요.";

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
}

function historyKey(interviewId: string) {
  return `donghaeng.borrower.question-answer.${interviewId}`;
}

function readHistory(interviewId: string): QuestionAnswer[] {
  if (typeof window === "undefined") return [];
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(historyKey(interviewId)) ?? "[]");
    if (!Array.isArray(value)) return [];
    return value.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.question !== "string" || typeof record.answer !== "string" || typeof record.createdAt !== "string") return [];
      return [{ id: record.id, question: record.question, answer: record.answer, createdAt: record.createdAt }];
    });
  } catch {
    return [];
  }
}

function persistHistory(interviewId: string, history: QuestionAnswer[]) {
  try {
    window.localStorage.setItem(historyKey(interviewId), JSON.stringify(history.slice(-30)));
  } catch {
    // This is only a borrower-side review aid. The source of truth is the server transcript.
  }
}

export function BorrowerInterviewRoom({ interviewId, initialMode, autoStartQuestionVoice = false }: BorrowerInterviewRoomProps) {
  const [snapshot, setSnapshot] = useState<InterviewSnapshotView | null>(null);
  const [method, setMethod] = useState<InterviewMethod>(initialMode);
  const [answer, setAnswer] = useState("");
  const [history, setHistory] = useState<QuestionAnswer[]>([]);
  const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [voiceBusy, setVoiceBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [speechPreparing, setSpeechPreparing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceProvider, setVoiceProvider] = useState<VoiceProvider>("qwen");
  const [voiceAutoplayEnabled, setVoiceAutoplayEnabled] = useState(
    initialMode === "voice" && autoStartQuestionVoice,
  );
  const currentQuestionRef = useRef<string | null>(null);
  const speechAudioRef = useRef<HTMLAudioElement | null>(null);
  const speechObjectUrlRef = useRef<string | null>(null);
  const speechAbortRef = useRef<AbortController | null>(null);
  const speechContextRef = useRef<AudioContext | null>(null);
  const speechSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const lastSpokenQuestionRef = useRef<string | null>(null);

  const fetchSnapshot = useCallback(async () => {
    const response = await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}`, { cache: "no-store" });
    const data = await readApiEnvelope(response);
    const nextSnapshot = adaptInterviewSnapshot(data);
    return nextSnapshot;
  }, [interviewId]);

  const refresh = useCallback(async () => {
    const nextSnapshot = await fetchSnapshot();
    setSnapshot(nextSnapshot);
  }, [fetchSnapshot]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => {
      if (active) setHistory(readHistory(interviewId));
    });
    fetchSnapshot()
      .then((nextSnapshot) => { if (active) setSnapshot(nextSnapshot); })
      .catch((caught: unknown) => { if (active) setError(caught instanceof Error ? caught.message : "인터뷰를 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [fetchSnapshot, interviewId]);

  const live: LiveInterviewView | null = snapshot?.snapshotType === "PREVIEW" ? snapshot : null;
  const question = live?.currentQuestion ?? null;
  const hasBorrowerResponse = live?.transcript.some((segment) => segment.speaker === "BORROWER") ?? false;
  const promptToSpeak = question
    ? hasBorrowerResponse ? question : `${INTERVIEW_WELCOME} ${question}`
    : null;
  useEffect(() => {
    currentQuestionRef.current = question;
  }, [question]);

  const stopSpeaking = useCallback(() => {
    speechAbortRef.current?.abort();
    speechAbortRef.current = null;
    speechSourceRef.current?.stop();
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

  const speakWithDeviceVoice = useCallback((text: string) => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setSpeechPreparing(false);
      setSpeaking(false);
      setError("AI 음성을 준비하지 못했습니다. 질문은 화면의 텍스트로 확인해 주세요.");
      return;
    }
    const voices = window.speechSynthesis.getVoices();
    const koreanVoice = voices.find((voice) => voice.lang.toLowerCase().startsWith("ko"));
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "ko-KR";
    utterance.rate = 0.94;
    if (koreanVoice) utterance.voice = koreanVoice;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => { setSpeaking(false); setError("AI 음성 재생을 시작하지 못했습니다. 질문은 화면의 텍스트로 확인할 수 있습니다."); };
    setSpeechPreparing(false);
    setSpeaking(true);
    setVoiceProvider("device");
    window.speechSynthesis.speak(utterance);
  }, []);

  const speakQuestion = useCallback(async (questionToSpeak = promptToSpeak) => {
    if (!questionToSpeak || typeof window === "undefined") return;
    stopSpeaking();
    setError(null);
    setSpeechPreparing(true);
    const controller = new AbortController();
    speechAbortRef.current = controller;
    try {
      const response = await authenticatedFetch(QUESTION_SPEECH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: questionToSpeak }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("QUESTION_TTS_UNAVAILABLE");
      const bytes = await response.arrayBuffer();
      if (!bytes.byteLength) throw new Error("QUESTION_TTS_EMPTY");
      if (controller.signal.aborted) return;
      const context = speechContextRef.current ?? currentQuestionVoicePlayback();
      if (context) speechContextRef.current = context;
      if (context?.state === "running") {
        const buffer = await context.decodeAudioData(bytes.slice(0));
        if (controller.signal.aborted) return;
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        speechSourceRef.current = source;
        source.onended = () => {
          if (speechSourceRef.current === source) {
            speechSourceRef.current = null;
            setSpeaking(false);
          }
        };
        source.start();
        setVoiceProvider("qwen");
        setSpeechPreparing(false);
        setSpeaking(true);
        return;
      }
      const objectUrl = URL.createObjectURL(new Blob([bytes], { type: response.headers.get("content-type") ?? "audio/wav" }));
      const audio = new Audio(objectUrl);
      audio.preload = "auto";
      audio.volume = 1;
      speechObjectUrlRef.current = objectUrl;
      speechAudioRef.current = audio;
      audio.onended = () => {
        if (speechAudioRef.current === audio) {
          speechAudioRef.current = null;
          if (speechObjectUrlRef.current === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            speechObjectUrlRef.current = null;
          }
          setSpeaking(false);
        }
      };
      audio.onerror = () => {
        if (speechAudioRef.current === audio) {
          speechAudioRef.current = null;
          if (speechObjectUrlRef.current === objectUrl) {
            URL.revokeObjectURL(objectUrl);
            speechObjectUrlRef.current = null;
          }
          setSpeaking(false);
          speakWithDeviceVoice(questionToSpeak);
        }
      };
      await audio.play();
      if (!controller.signal.aborted) {
        setVoiceProvider("qwen");
        setSpeechPreparing(false);
        setSpeaking(true);
      }
    } catch {
      if (controller.signal.aborted) return;
      stopSpeaking();
      // A local Qwen service can be intentionally stopped. Device TTS keeps
      // the borrower flow audible without ever fabricating an interview answer.
      speakWithDeviceVoice(questionToSpeak);
    }
  }, [promptToSpeak, speakWithDeviceVoice, stopSpeaking]);

  const startVoiceConversation = useCallback(() => {
    if (!promptToSpeak) return;
    unlockQuestionVoice();
    setVoiceAutoplayEnabled(true);
    lastSpokenQuestionRef.current = promptToSpeak;
    void speakQuestion(promptToSpeak);
  }, [promptToSpeak, speakQuestion, unlockQuestionVoice]);

  useEffect(() => {
    if (method !== "voice" || !voiceAutoplayEnabled || !promptToSpeak || speaking || voiceBusy) return;
    if (lastSpokenQuestionRef.current === promptToSpeak) return;
    lastSpokenQuestionRef.current = promptToSpeak;
    const timer = window.setTimeout(() => void speakQuestion(promptToSpeak), 160);
    return () => window.clearTimeout(timer);
  }, [method, promptToSpeak, speakQuestion, speaking, voiceAutoplayEnabled, voiceBusy]);

  useEffect(() => () => {
    stopSpeaking();
    releaseQuestionVoicePlayback(speechContextRef.current);
    speechContextRef.current = null;
  }, [stopSpeaking]);

  const addQuestionAnswer = useCallback((questionText: string, answerText: string) => {
    const row: QuestionAnswer = { id: createClientCommandId("qa"), question: questionText, answer: answerText, createdAt: new Date().toISOString() };
    setHistory((previous) => {
      const next = [...previous, row];
      persistHistory(interviewId, next);
      return next;
    });
    setSelectedHistoryId(row.id);
  }, [interviewId]);

  async function submitAnswer(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending || !live || !question) return;
    setSending(true);
    setError(null);
    stopSpeaking();
    const answeredQuestion = question;
    try {
      const response = await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: trimmed,
          clientMessageId: createClientCommandId("borrower-message"),
          expectedVersion: live.version,
          currentQuestionInfoCode: live.currentQuestionInfoCode,
          transcriptMetadata: null,
        }),
      });
      const data = await readApiEnvelope(response);
      const processing = extractMessageProcessingTelemetry(data);
      setSnapshot(adaptInterviewSnapshot(data));
      addQuestionAnswer(answeredQuestion, trimmed);
      setAnswer("");
      if (processing?.status === "RETRYABLE_FAILURE") setError("답변은 안전하게 저장됐지만 AI 정리가 잠시 지연되고 있어요. 잠시 후 새로고침해 주세요.");
      if (processing?.status === "NON_RETRYABLE_FAILURE") setError("답변은 저장됐어요. 지금은 AI 정리를 적용할 수 없어 담당자가 확인합니다.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "답변을 전송하지 못했습니다. 입력 내용은 그대로 남아 있습니다.");
    } finally {
      setSending(false);
    }
  }

  const selectedHistory = useMemo(() => history.find((row) => row.id === selectedHistoryId) ?? history.at(-1) ?? null, [history, selectedHistoryId]);
  const transcriptMessages = live?.transcript ?? [];
  const latestAssistantMessage = [...transcriptMessages]
    .reverse()
    .find((segment) => segment.speaker === "ASSISTANT") ?? null;
  const responseDisabled = !live || sending || voiceBusy || !question || live.pendingCommand !== null;

  if (loading) return <main id="main-content" className="borrower-room borrower-room--loading"><LoaderCircle className="spin" size={30} /> 인터뷰를 준비하고 있어요.</main>;
  if (!snapshot || error && !live) return <main id="main-content" className="borrower-room borrower-room--loading"><p>{error ?? "인터뷰를 불러오지 못했습니다."}</p><button type="button" className="borrower-secondary-button" onClick={() => void refresh()}>다시 불러오기</button></main>;
  if (snapshot.snapshotType === "FINAL") return <main id="main-content" className="borrower-room borrower-room--complete"><CheckCircle2 size={42} /><span>인터뷰 기록을 정리했어요</span><h1>사장님이 확인한 답변을 안전하게 보관했습니다.</h1><p>필요한 경우 담당자가 다음 절차를 안내해 드립니다.</p></main>;

  return (
    <main id="main-content" className="borrower-room">
      <header className="borrower-room__header">
        <div><span className="borrower-room__step">사장님 인터뷰 · 진행 중</span><h1>{snapshot.businessName} 이야기를 듣고 있어요</h1><p>현재까지 {snapshot.resolvedRequired ?? 0}개를 확인했어요. 어려운 질문은 모른다고 말씀하셔도 괜찮습니다.</p></div>
        <div className="borrower-room__progress" aria-label={`인터뷰 진행 ${formatPercent(snapshot.requiredInformationRate)}`}><strong>{formatPercent(snapshot.requiredInformationRate)}</strong><span><i style={{ width: `${snapshot.requiredInformationRate ?? 0}%` }} /></span></div>
      </header>
      <div className="borrower-room__layout">
        <section className="borrower-conversation" aria-label="AI와 사장님의 대화">
          <div className="borrower-conversation__mode">
            <button type="button" data-active={method === "chat"} onClick={() => { stopSpeaking(); setVoiceAutoplayEnabled(false); setMethod("chat"); }}><MessageCircle size={16} /> 채팅 답변</button>
            <button type="button" data-active={method === "voice"} onClick={() => { setVoiceAutoplayEnabled(false); setMethod("voice"); }}><Mic size={16} /> 음성 답변</button>
            <small className="borrower-neural-voice-status" data-provider={voiceProvider}>
              {speechPreparing
                ? "AI 음성을 준비하고 있어요"
                : speaking
                  ? "AI 질문을 음성으로 안내 중"
                  : voiceAutoplayEnabled
                    ? "다음 AI 질문도 음성으로 안내합니다"
                    : "AI 질문 음성 준비됨"}
            </small>
          </div>
          <div className="borrower-conversation__timeline" aria-live="polite">
            {!hasBorrowerResponse && (
              <div className="borrower-welcome" role="note">
                <strong>안녕하세요, 사장님.</strong>
                <p>정답을 찾는 자리가 아니라 사장님 사업 이야기를 듣는 시간이에요. 답하기 어려운 내용은 모른다고 말씀하셔도 괜찮습니다.</p>
              </div>
            )}
            {transcriptMessages.map((message) => message.speaker === "ASSISTANT" ? (
              <article className="borrower-message borrower-message--ai" key={message.id}>
                <div className="borrower-message__meta">
                  <span>동행 AI</span>
                  {message.id === latestAssistantMessage?.id && question && (
                    <button type="button" onClick={speaking || speechPreparing ? stopSpeaking : () => { unlockQuestionVoice(); lastSpokenQuestionRef.current = promptToSpeak; void speakQuestion(); }}>
                      {speechPreparing ? "음성 준비 취소" : speaking ? "읽기 멈춤" : "다시 듣기"} <Volume2 size={15} />
                    </button>
                  )}
                </div>
                <p>{message.text}</p>
              </article>
            ) : (
              <article className="borrower-message borrower-message--owner" key={message.id}>
                <span>사장님 답변</span><p>{message.text}</p>
              </article>
            ))}
            {transcriptMessages.length === 0 && (
              <article className="borrower-message borrower-message--ai"><span>동행 AI</span><p>{question ?? "인터뷰를 준비하고 있어요."}</p></article>
            )}
          </div>
          {method === "chat" ? (
            <form className="borrower-answer-box" onSubmit={(event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void submitAnswer(answer); }}>
              <label htmlFor="borrower-answer">사장님의 답변</label>
              <textarea id="borrower-answer" value={answer} onChange={(event) => setAnswer(event.target.value)} rows={3} maxLength={3000} disabled={responseDisabled} placeholder="편하게 말씀해 주세요. 예: 최근에는 배달 수수료 부담이 가장 커졌어요." />
              <div><small>Enter로 전송 · 답변은 언제든 다시 확인할 수 있어요.</small><button className="borrower-primary-button" type="submit" disabled={responseDisabled || !answer.trim()}>{sending ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />} 답변 보내기</button></div>
            </form>
          ) : (
            <div className="borrower-voice-box"><div><strong>말씀하신 그대로 전사합니다</strong><p>전사가 끝나면 사장님 답변으로 바로 저장하고, 다음 질문을 상황에 맞춰 이어갑니다.</p></div>{!voiceAutoplayEnabled && <button type="button" className="borrower-voice-start" onClick={startVoiceConversation} disabled={!question || responseDisabled}><Volume2 size={17} /> AI 질문을 듣고 음성 인터뷰 시작</button>}<AudioInterviewControls interviewId={interviewId} currentQuestion={question} disabled={responseDisabled} borrowerMode showQuestionVoiceControl={false} onBusyChange={setVoiceBusy} onServerFinal={async (text) => { if (currentQuestionRef.current) addQuestionAnswer(currentQuestionRef.current, text); await refresh(); }} onStatusChange={(status) => { if (status.uxState === "LISTENING") stopSpeaking(); }} /></div>
          )}
          {error && <div className="borrower-room__error" role="alert">{error}<button type="button" onClick={() => void refresh()}><RefreshCw size={14} /> 상태 새로고침</button></div>}
        </section>
        <aside className="borrower-review" aria-label="내 질문과 답변 확인">
          <div className="borrower-review__heading"><div><span>내 인터뷰 기록</span><h2>질문·답변 확인</h2></div><strong>{history.length}개</strong></div>
          {history.length === 0 ? <div className="borrower-review__empty">첫 답변을 보내면 이곳에서 질문과 답변을 다시 확인할 수 있어요.</div> : <div className="borrower-review__list">{history.map((row, index) => <button type="button" key={row.id} data-active={selectedHistory?.id === row.id} onClick={() => setSelectedHistoryId(row.id)}><span>질문 {index + 1}</span><strong>{row.question}</strong><ChevronRight size={16} /></button>)}</div>}
          {selectedHistory && <section className="borrower-review__detail"><button type="button" className="borrower-review__detail-title" onClick={() => setSelectedHistoryId(null)}><span>선택한 질문과 답변</span><ChevronDown size={16} /></button><dl><div><dt>AI 질문</dt><dd>{selectedHistory.question}</dd></div><div><dt>사장님 답변</dt><dd>{selectedHistory.answer}</dd></div></dl><p>말씀하신 내용이 다르면 채팅으로 알려 주세요. 다음 질문에 반영됩니다.</p></section>}
        </aside>
      </div>
    </main>
  );
}
