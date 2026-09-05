"use client";

import {
  Headphones,
  LoaderCircle,
  Mic,
  MicOff,
  PhoneOff,
  RotateCcw,
  Waves,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  authenticatedFetch,
  readApiEnvelope,
} from "@/components/api-adapter";
import {
  canonicalQuestionResponseEvent,
  parseRealtimeClientSecret,
  parseRealtimeVoiceEvent,
} from "@/realtime/openai-realtime-voice";
import type { AudioUxState, LiveConnectionState } from "@/realtime/live-store";
import { checkMicrophoneConsent, checkVoiceProcessingConsent, isMicrophoneConsentRequired, voiceConnectionFailure } from "./voice-connection-preflight";

interface RealtimeVoiceInterviewProps {
  interviewId: string;
  currentQuestion: string;
  questionKey: string;
  disabled: boolean;
  onFinalTranscript: (text: string) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onStatusChange?: (status: {
    uxState: AudioUxState;
    connection: LiveConnectionState;
    providerLabel: string | null;
  }) => void;
  onUnavailable: (message: string) => void;
}

interface PendingQuestion {
  text: string;
  key: string;
  includeWelcome: boolean;
}

const CONNECTION_TIMEOUT_MS = 12_000;

function realtimeStatusLabel(
  connection: LiveConnectionState,
  uxState: AudioUxState,
): string {
  if (connection === "CONNECTING") return "실시간 통화 연결 중";
  if (connection === "ERROR") return "실시간 연결 확인 필요";
  if (uxState === "AI_SPEAKING") return "동행 AI가 말하고 있어요";
  if (uxState === "LISTENING") return "사장님 말씀을 듣고 있어요";
  if (uxState === "TRANSCRIBING") return "말씀을 바로 옮기고 있어요";
  if (uxState === "AI_THINKING") return "답변을 반영하고 있어요";
  return connection === "OPEN" ? "실시간 통화 연결됨" : "실시간 음성 대기";
}

export function RealtimeVoiceInterview({
  interviewId,
  currentQuestion,
  questionKey,
  disabled,
  onFinalTranscript,
  onBusyChange,
  onStatusChange,
  onUnavailable,
}: RealtimeVoiceInterviewProps) {
  const [connection, setConnection] = useState<LiveConnectionState>("CLOSED");
  const [uxState, setUxState] = useState<AudioUxState>("IDLE");
  const [started, setStarted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [assistantTranscript, setAssistantTranscript] = useState("");
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [consentState, setConsentState] = useState<"checking" | "required" | "ready">("checking");
  const [microphoneConsent, setMicrophoneConsent] = useState(false);
  const [canUseAlternative, setCanUseAlternative] = useState(false);

  useEffect(() => {
    let active = true;
    void checkMicrophoneConsent(interviewId).then(() => {
      if (active) setConsentState("ready");
    }).catch((caught: unknown) => {
      if (!active) return;
      if (isMicrophoneConsentRequired(caught)) setConsentState("required");
      else { setConsentState("ready"); setError(voiceConnectionFailure(caught).message); }
    });
    return () => { active = false; };
  }, [interviewId]);

  const peerRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);
  const reviewCallRef = useRef<{ id: string; interviewId: string } | null>(null);
  const reviewDeadlineRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const channelDeadlineRef = useRef<number | null>(null);
  const mountedRef = useRef(false);
  const startRunRef = useRef(0);
  const responseActiveRef = useRef(false);
  const pendingQuestionRef = useRef<PendingQuestion | null>(null);
  const lastQuestionKeyRef = useRef<string | null>(null);
  const includeWelcomeRef = useRef(true);
  const handledInputItemsRef = useRef(new Set<string>());
  const turnSequenceRef = useRef(0);
  const disabledRef = useRef(disabled);
  const finalCallbackRef = useRef(onFinalTranscript);

  useEffect(() => {
    disabledRef.current = disabled;
    for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
      track.enabled = !disabled && !muted;
    }
  }, [disabled, muted]);

  useEffect(() => {
    finalCallbackRef.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    const busy = connection === "CONNECTING" || [
      "LISTENING",
      "TRANSCRIBING",
      "AI_THINKING",
      "AI_SPEAKING",
    ].includes(uxState);
    onBusyChange?.(busy);
    onStatusChange?.({ uxState, connection, providerLabel });
  }, [connection, onBusyChange, onStatusChange, providerLabel, uxState]);

  const closeRealtime = useCallback((updateState = true) => {
    if (channelDeadlineRef.current) clearTimeout(channelDeadlineRef.current);
    channelDeadlineRef.current = null;
    if (reviewDeadlineRef.current) clearTimeout(reviewDeadlineRef.current);
    reviewDeadlineRef.current = null;
    const reviewCall = reviewCallRef.current;
    reviewCallRef.current = null;
    if (reviewCall) {
      // Best effort on navigation; the server's persistent deadline is the
      // authoritative limit even when a browser disappears without this call.
      void fetch(`/api/interviews/${encodeURIComponent(reviewCall.interviewId)}/realtime-call`, {
        method: "DELETE", credentials: "include", keepalive: true,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ callId: reviewCall.id }),
      }).catch(() => undefined);
    }
    startRunRef.current += 1;
    pendingQuestionRef.current = null;
    responseActiveRef.current = false;
    handledInputItemsRef.current.clear();
    try {
      dataChannelRef.current?.close();
    } catch {
      // The data channel may already be closing after a network failure.
    }
    dataChannelRef.current = null;
    try {
      peerRef.current?.close();
    } catch {
      // The peer connection may already be closed.
    }
    peerRef.current = null;
    for (const track of localStreamRef.current?.getTracks() ?? []) track.stop();
    localStreamRef.current = null;
    const remoteAudio = remoteAudioRef.current;
    if (remoteAudio) {
      remoteAudio.pause();
      remoteAudio.srcObject = null;
      remoteAudio.remove();
    }
    remoteAudioRef.current = null;
    if (updateState && mountedRef.current) {
      setStarted(false);
      setConnection("CLOSED");
      setUxState("IDLE");
      setMuted(false);
      setInterimTranscript("");
      setAssistantTranscript("");
    }
  }, []);

  const sendEvent = useCallback((event: Record<string, unknown>): boolean => {
    const channel = dataChannelRef.current;
    if (!channel || channel.readyState !== "open") return false;
    channel.send(JSON.stringify(event));
    return true;
  }, []);

  const sendQuestionNow = useCallback((question: PendingQuestion): boolean => {
    const sent = sendEvent(canonicalQuestionResponseEvent(
      question.text,
      question.key,
      question.includeWelcome,
    ));
    if (!sent) return false;
    lastQuestionKeyRef.current = question.key;
    includeWelcomeRef.current = false;
    pendingQuestionRef.current = null;
    responseActiveRef.current = true;
    setAssistantTranscript("");
    setUxState("AI_SPEAKING");
    return true;
  }, [sendEvent]);

  const requestQuestionSpeech = useCallback((question: PendingQuestion) => {
    if (
      !question.text.trim() ||
      lastQuestionKeyRef.current === question.key
    ) {
      return;
    }
    if (responseActiveRef.current || disabledRef.current) {
      pendingQuestionRef.current = question;
      return;
    }
    sendQuestionNow(question);
  }, [sendQuestionNow]);

  const handleRealtimeMessage = useCallback((message: MessageEvent<string>) => {
    const parsed = parseRealtimeVoiceEvent(message.data);
    if (parsed.type === "SESSION_READY") return;
    if (parsed.type === "SPEECH_STARTED") {
      turnSequenceRef.current += 1;
      setInterimTranscript("");
      setFinalTranscript("");
      setAssistantTranscript("");
      setUxState("LISTENING");
      return;
    }
    if (parsed.type === "SPEECH_STOPPED") {
      setUxState("TRANSCRIBING");
      return;
    }
    if (parsed.type === "INPUT_TRANSCRIPT_DELTA") {
      setInterimTranscript((previous) => `${previous}${parsed.delta}`);
      return;
    }
    if (parsed.type === "INPUT_TRANSCRIPT_DONE") {
      const transcript = parsed.transcript.trim();
      if (!transcript) return;
      const itemKey = parsed.itemId ?? `turn-${turnSequenceRef.current}`;
      if (handledInputItemsRef.current.has(itemKey)) return;
      handledInputItemsRef.current.add(itemKey);
      setInterimTranscript("");
      setFinalTranscript(transcript);
      setUxState("AI_THINKING");
      for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
        track.enabled = false;
      }
      void Promise.resolve(finalCallbackRef.current(transcript)).catch((caught: unknown) => {
        if (!mountedRef.current) return;
        setError(caught instanceof Error ? caught.message : "답변을 저장하지 못했습니다.");
        setUxState("ERROR");
      });
      return;
    }
    if (parsed.type === "ASSISTANT_TRANSCRIPT_DELTA") {
      setAssistantTranscript((previous) => `${previous}${parsed.delta}`);
      return;
    }
    if (parsed.type === "ASSISTANT_TRANSCRIPT_DONE") {
      setAssistantTranscript(parsed.transcript);
      return;
    }
    if (parsed.type === "RESPONSE_STARTED") {
      responseActiveRef.current = true;
      setUxState("AI_SPEAKING");
      return;
    }
    if (parsed.type === "RESPONSE_AUDIO_DONE") {
      if (!disabledRef.current) setUxState("LISTENING");
      return;
    }
    if (parsed.type === "RESPONSE_DONE") {
      responseActiveRef.current = false;
      const pending = pendingQuestionRef.current;
      if (pending && !disabledRef.current) {
        sendQuestionNow(pending);
      } else if (disabledRef.current) {
        setUxState("AI_THINKING");
      } else {
        setUxState("LISTENING");
      }
      return;
    }
    if (parsed.type === "ERROR") {
      responseActiveRef.current = false;
      setError(parsed.message);
      setUxState("ERROR");
    }
  }, [sendQuestionNow]);

  const startRealtime = useCallback(async () => {
    if (started || connection === "CONNECTING" || disabled || consentState === "checking" || (consentState === "required" && !microphoneConsent)) return;
    closeRealtime(false);
    const runId = startRunRef.current + 1;
    startRunRef.current = runId;
    setConnection("CONNECTING");
    setUxState("AI_THINKING");
    setError(null);
    setCanUseAlternative(false);
    setInterimTranscript("");
    setFinalTranscript("");
    setAssistantTranscript("");
    lastQuestionKeyRef.current = null;
    includeWelcomeRef.current = true;
    try {
      await checkVoiceProcessingConsent(interviewId);
      if (runId !== startRunRef.current) return;
      await checkMicrophoneConsent(interviewId, consentState === "required" && microphoneConsent);
      if (runId !== startRunRef.current) return;
      setConsentState("ready");
      if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === "undefined") {
        throw new Error("이 브라우저는 실시간 음성 통화를 지원하지 않습니다.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      if (runId !== startRunRef.current) {
        for (const track of stream.getTracks()) track.stop();
        return;
      }
      localStreamRef.current = stream;

      const tokenResponse = await authenticatedFetch(
        `/api/interviews/${encodeURIComponent(interviewId)}/realtime-session`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      const tokenPayload = await readApiEnvelope(tokenResponse);
      if (runId !== startRunRef.current) return;
      const serverTransport = typeof tokenPayload === "object" && tokenPayload !== null &&
        "transport" in tokenPayload && tokenPayload.transport === "server";
      const token = parseRealtimeClientSecret(tokenPayload);
      if (!token && !serverTransport) throw new Error("실시간 음성 연결 정보를 확인하지 못했습니다.");
      setProviderLabel(serverTransport ? "실시간 음성 · 최대 10분 · 하루 2회" : `OpenAI · ${token!.model} · ${token!.voice}`);

      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      const remoteAudio = document.createElement("audio");
      remoteAudio.autoplay = true;
      remoteAudio.setAttribute("playsinline", "true");
      remoteAudio.setAttribute("aria-hidden", "true");
      remoteAudio.style.display = "none";
      document.body.appendChild(remoteAudio);
      remoteAudioRef.current = remoteAudio;
      peer.ontrack = (event) => {
        remoteAudio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
        void remoteAudio.play().catch(() => {
          if (!mountedRef.current) return;
          setError("AI 음성 재생이 차단됐습니다. 화면을 한 번 누른 뒤 질문 다시 듣기를 눌러 주세요.");
        });
      };
      peer.onconnectionstatechange = () => {
        if (!mountedRef.current) return;
        if (peer.connectionState === "failed") {
          setConnection("ERROR");
          setUxState("ERROR");
          setError("실시간 통화 연결이 끊겼습니다. 다시 연결해 주세요.");
        }
      };
      for (const track of stream.getAudioTracks()) peer.addTrack(track, stream);

      const dataChannel = peer.createDataChannel("oai-events");
      dataChannelRef.current = dataChannel;
      dataChannel.onmessage = handleRealtimeMessage;
      const channelOpen = new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(
          () => reject(new Error("실시간 통화 연결 시간이 초과되었습니다.")),
          CONNECTION_TIMEOUT_MS + 20_000,
        );
        channelDeadlineRef.current = timeout;
        dataChannel.addEventListener("open", () => {
          window.clearTimeout(timeout);
          resolve();
        }, { once: true });
        dataChannel.addEventListener("error", () => {
          window.clearTimeout(timeout);
          reject(new Error("실시간 통화 데이터 채널을 열지 못했습니다."));
        }, { once: true });
      });

      // SDP rejection can exit before awaiting channelOpen. Mark rejection as
      // handled now; the awaited original still reports connection failures.
      void channelOpen.catch(() => undefined);

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      let answerSdp: string;
      if (serverTransport) {
        const callResponse = await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/realtime-call`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sdp: offer.sdp ?? "" }), signal: AbortSignal.timeout(20_000),
        });
        const call = await readApiEnvelope(callResponse) as { id: string; sdp: string; deadline: string };
        if (typeof call.id !== "string" || typeof call.sdp !== "string" || !Number.isFinite(Date.parse(call.deadline))) {
          throw new Error("실시간 통화 응답을 확인하지 못했습니다.");
        }
        reviewCallRef.current = { id: call.id, interviewId };
        if (runId !== startRunRef.current) { closeRealtime(false); return; }
        answerSdp = call.sdp;
        reviewDeadlineRef.current = setTimeout(() => {
          closeRealtime();
          setError("10분 통화가 끝났습니다. 답변은 저장되어 있으며 채팅으로 계속하거나 다시 연결할 수 있습니다.");
          setCanUseAlternative(true);
        }, Math.max(0, Date.parse(call.deadline) - Date.now()));
      } else {
        const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token!.value}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp ?? "",
        signal: AbortSignal.timeout(CONNECTION_TIMEOUT_MS),
      });
      if (!sdpResponse.ok) {
        throw new Error("실시간 통화 연결을 승인받지 못했습니다.");
      }
        answerSdp = await sdpResponse.text();
      }
      if (!answerSdp.trim()) throw new Error("실시간 통화 응답이 비어 있습니다.");
      await peer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      await channelOpen;
      if (runId !== startRunRef.current) return;

      setStarted(true);
      setConnection("OPEN");
      setUxState("AI_SPEAKING");
      requestQuestionSpeech({
        text: currentQuestion,
        key: questionKey,
        includeWelcome: includeWelcomeRef.current,
      });
    } catch (caught) {
      if (runId !== startRunRef.current) return;
      closeRealtime(false);
      if (!mountedRef.current) return;
      const failure = voiceConnectionFailure(caught);
      if (isMicrophoneConsentRequired(caught)) { setConsentState("required"); setMicrophoneConsent(false); }
      setConnection("ERROR");
      setUxState("ERROR");
      setError(failure.message);
      setCanUseAlternative(failure.canUseAlternative);
    }
  }, [
    closeRealtime,
    connection,
    currentQuestion,
    disabled,
    handleRealtimeMessage,
    interviewId,
    consentState,
    microphoneConsent,
    questionKey,
    requestQuestionSpeech,
    started,
  ]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeRealtime(false);
    };
  }, [closeRealtime]);

  useEffect(() => {
    if (!started || connection !== "OPEN" || !currentQuestion.trim()) return;
    requestQuestionSpeech({
      text: currentQuestion,
      key: questionKey,
      includeWelcome: includeWelcomeRef.current,
    });
  }, [connection, currentQuestion, questionKey, requestQuestionSpeech, started]);

  useEffect(() => {
    if (!started || connection !== "OPEN" || disabled) return;
    const pending = pendingQuestionRef.current;
    if (pending && !responseActiveRef.current) sendQuestionNow(pending);
  }, [connection, disabled, sendQuestionNow, started]);

  const toggleMute = useCallback(() => {
    setMuted((current) => {
      const next = !current;
      for (const track of localStreamRef.current?.getAudioTracks() ?? []) {
        track.enabled = !next && !disabledRef.current;
      }
      setUxState(next ? "PAUSED" : "LISTENING");
      return next;
    });
  }, []);

  const replayQuestion = useCallback(() => {
    lastQuestionKeyRef.current = null;
    requestQuestionSpeech({
      text: currentQuestion,
      key: `${questionKey}:replay:${Date.now()}`,
      includeWelcome: false,
    });
  }, [currentQuestion, questionKey, requestQuestionSpeech]);

  const statusLabel = realtimeStatusLabel(connection, uxState);
  const displayedTranscript = interimTranscript || finalTranscript;

  return (
    <section className="realtime-voice-call" data-connection={connection.toLowerCase()}>
      <div className="realtime-voice-call__heading">
        <div className="realtime-voice-call__identity">
          <span className="realtime-voice-call__pulse" aria-hidden="true"><Waves size={18} /></span>
          <div>
            <strong>음성 인터뷰</strong>
            <small>AI와 실시간으로 대화합니다</small>
          </div>
        </div>
        <span className="realtime-voice-call__status" role="status" aria-live="polite">
          {connection === "CONNECTING" && <LoaderCircle className="spin" size={14} />}
          {statusLabel}
        </span>
      </div>

      {consentState === "required" && !started && <label className="borrower-consent realtime-voice-call__consent"><input type="checkbox" checked={microphoneConsent} disabled={connection === "CONNECTING"} onChange={(event) => setMicrophoneConsent(event.target.checked)} /><span>마이크로 말한 내용을 전사하고 인터뷰 답변으로 저장하는 데 동의합니다.<small>음성 대화는 OpenAI에서 처리합니다. 음성 원본은 이 서비스에 저장하지 않으며, 언제든 음소거하거나 채팅으로 바꿀 수 있습니다.</small></span></label>}
      {!started ? (
        <button
          type="button"
          className="borrower-voice-start realtime-voice-call__start"
          onClick={() => void startRealtime()}
          disabled={disabled || connection === "CONNECTING" || consentState === "checking" || (consentState === "required" && !microphoneConsent)}
        >
          {connection === "CONNECTING"
            ? <LoaderCircle className="spin" size={18} />
            : <Headphones size={18} />}
          {consentState === "checking" ? "음성 이용 안내 확인 중" : connection === "CONNECTING" ? "실시간 통화 연결 중" : connection === "ERROR" ? "음성 연결 다시 시도" : "실시간 음성 대화 시작"}
        </button>
      ) : (
        <>
          <div className="realtime-voice-call__captions" aria-live="polite">
            <div data-speaker="ai">
              <span>동행 AI</span>
              <p>{assistantTranscript || (uxState === "AI_SPEAKING" ? "말하는 중…" : "사장님 말씀을 기다리고 있어요.")}</p>
            </div>
            <div data-speaker="borrower">
              <span>사장님</span>
              <p>{displayedTranscript || (uxState === "LISTENING" ? "듣고 있어요…" : "말씀하신 내용이 여기에 바로 표시됩니다.")}</p>
            </div>
          </div>
          <div className="realtime-voice-call__controls">
            <button type="button" onClick={toggleMute} disabled={disabled && !muted}>
              {muted ? <MicOff size={16} /> : <Mic size={16} />}
              {muted ? "마이크 켜기" : "잠시 음소거"}
            </button>
            <button type="button" onClick={replayQuestion} disabled={disabled}>
              <RotateCcw size={16} /> 질문 다시 듣기
            </button>
            <button type="button" className="realtime-voice-call__hangup" onClick={() => closeRealtime()}>
              <PhoneOff size={16} /> 대화 종료
            </button>
          </div>
        </>
      )}
      {error && <p className="realtime-voice-call__error" role="alert">{error}</p>}
      {!started && error && canUseAlternative && <button type="button" className="borrower-text-button" onClick={() => onUnavailable(error)}>문장 단위 음성으로 전환</button>}
      <details className="realtime-voice-call__connection-info">
        <summary>음성 연결 정보</summary>
        <p>{providerLabel ?? "WebRTC · GPT-Realtime-2.1 연결 준비"}</p>
      </details>
    </section>
  );
}
