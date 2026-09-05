"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  AUDIO_PROTOCOL_VERSION,
  encodeAudioFrame,
  parseAudioServerMessage,
  type AudioControlMessage,
} from "./audio-protocol";
import {
  BoundedAudioReplayBuffer,
  DEFAULT_AUDIO_CHUNK_MS,
  MAX_WS_BUFFERED_BYTES,
  selectSupportedAudioMimeType,
} from "./media-recorder";
import type {
  AudioUxState,
  LiveConnectionState,
} from "./live-store";
import { realtimeLatencyTelemetry } from "./latency-telemetry";

interface UseAudioInterviewOptions {
  interviewId: string;
  disabled: boolean;
  autoEndOnSilence?: boolean;
  silenceThresholdMs?: number;
  onFinalTranscript?: (text: string) => void | Promise<void>;
  onRecognizedTranscript?: (text: string) => void | Promise<void>;
}

export interface AiSpeakingStartTransition {
  nextState: "AI_SPEAKING";
  restoreState: AudioUxState;
  pauseCapture: boolean;
}

export interface AiSpeakingEndTransition {
  nextState: AudioUxState;
  resumeCapture: boolean;
}

export function shouldScheduleAudioReconnect(input: {
  intentionalClose: boolean;
  currentAudioSessionId: string | null;
  requestedAudioSessionId: string;
  reconnectAlreadyScheduled: boolean;
}): boolean {
  return !input.intentionalClose &&
    input.currentAudioSessionId === input.requestedAudioSessionId &&
    !input.reconnectAlreadyScheduled;
}

export function beginAiSpeakingTransition(
  currentState: AudioUxState,
): AiSpeakingStartTransition | null {
  if (["TRANSCRIBING", "AI_THINKING", "AI_SPEAKING"].includes(currentState)) {
    return null;
  }
  return {
    nextState: "AI_SPEAKING",
    restoreState: currentState,
    pauseCapture: currentState === "LISTENING",
  };
}

export function endAiSpeakingTransition(
  restoreState: AudioUxState,
): AiSpeakingEndTransition {
  if (restoreState === "LISTENING") {
    return { nextState: "LISTENING", resumeCapture: true };
  }
  return {
    nextState:
      restoreState === "PAUSED" || restoreState === "ERROR"
        ? restoreState
        : "IDLE",
    resumeCapture: false,
  };
}

export interface AudioInterviewController {
  uxState: AudioUxState;
  connection: LiveConnectionState;
  level: number;
  interimTranscript: string;
  finalTranscript: string;
  providerLabel: string | null;
  mimeType: string | null;
  error: string | null;
  isSupported: boolean;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  beginAiSpeaking: () => boolean;
  endAiSpeaking: () => void;
  endTurn: () => Promise<void>;
  stop: () => void;
}

interface RuntimeResources {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  context: AudioContext | null;
  analyser: AnalyserNode | null;
  socket: WebSocket | null;
  audioSessionId: string | null;
  audioSeq: number;
  lastAckedAudioSeq: number;
  mimeType: string | null;
  animationFrame: number | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  reconnectAttempts: number;
  resumeCaptureAfterReconnect: boolean;
  pendingChunkSends: Set<Promise<void>>;
  controlAckWaiters: Map<
    string,
    {
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >;
  backpressureTimer: ReturnType<typeof setTimeout> | null;
  intentionalClose: boolean;
}

function newRuntime(): RuntimeResources {
  return {
    stream: null,
    recorder: null,
    context: null,
    analyser: null,
    socket: null,
    audioSessionId: null,
    audioSeq: 0,
    lastAckedAudioSeq: 0,
    mimeType: null,
    animationFrame: null,
    reconnectTimer: null,
    reconnectAttempts: 0,
    resumeCaptureAfterReconnect: false,
    pendingChunkSends: new Set(),
    controlAckWaiters: new Map(),
    backpressureTimer: null,
    intentionalClose: false,
  };
}

function friendlyMicrophoneError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError") {
      return "마이크 권한이 거절되었습니다. 아래 텍스트 입력으로 계속 진행해 주세요.";
    }
    if (error.name === "NotFoundError") {
      return "사용 가능한 마이크를 찾지 못했습니다. 텍스트 입력으로 계속할 수 있습니다.";
    }
    if (error.name === "NotReadableError") {
      return "마이크를 다른 앱이 사용 중입니다. 장치를 확인하거나 텍스트로 전환해 주세요.";
    }
  }
  return error instanceof Error
    ? error.message
    : "마이크를 시작하지 못했습니다. 텍스트 입력으로 계속할 수 있습니다.";
}

export function useAudioInterview({
  interviewId,
  disabled,
  autoEndOnSilence = false,
  silenceThresholdMs = 1_000,
  onFinalTranscript,
  onRecognizedTranscript,
}: UseAudioInterviewOptions): AudioInterviewController {
  const runtime = useRef<RuntimeResources>(newRuntime());
  const replay = useRef(new BoundedAudioReplayBuffer());
  const mounted = useRef(true);
  const finalCallback = useRef(onFinalTranscript);
  const recognizedCallback = useRef(onRecognizedTranscript);
  const uxStateRef = useRef<AudioUxState>("IDLE");
  const reconnectCallback = useRef<(audioSessionId: string) => void>(() => undefined);
  const endTurnCallback = useRef<() => Promise<void>>(async () => undefined);
  const speechDetected = useRef(false);
  const lastVoiceAt = useRef<number | null>(null);
  const autoFinalizeTriggered = useRef(false);
  const stateBeforeAiSpeaking = useRef<AudioUxState>("IDLE");

  const [uxState, setUxState] = useState<AudioUxState>("IDLE");
  const [connection, setConnection] = useState<LiveConnectionState>("CLOSED");
  const [level, setLevel] = useState(0);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [providerLabel, setProviderLabel] = useState<string | null>(null);
  const [mimeType, setMimeType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    finalCallback.current = onFinalTranscript;
  }, [onFinalTranscript]);

  useEffect(() => {
    recognizedCallback.current = onRecognizedTranscript;
  }, [onRecognizedTranscript]);

  useEffect(() => {
    uxStateRef.current = uxState;
  }, [uxState]);

  const isSupported =
    typeof window !== "undefined" &&
    typeof navigator.mediaDevices?.getUserMedia === "function" &&
    typeof MediaRecorder !== "undefined" &&
    typeof WebSocket !== "undefined";

  const cleanupMeter = useCallback(() => {
    if (runtime.current.animationFrame !== null) {
      cancelAnimationFrame(runtime.current.animationFrame);
      runtime.current.animationFrame = null;
    }
    if (mounted.current) setLevel(0);
  }, []);

  const cleanupMedia = useCallback(() => {
    cleanupMeter();
    const resources = runtime.current;
    if (resources.backpressureTimer) clearTimeout(resources.backpressureTimer);
    resources.backpressureTimer = null;
    if (resources.recorder && resources.recorder.state !== "inactive") {
      resources.recorder.stop();
    }
    resources.recorder = null;
    for (const track of resources.stream?.getTracks() ?? []) track.stop();
    resources.stream = null;
    if (resources.context && resources.context.state !== "closed") {
      void resources.context.close();
    }
    resources.context = null;
    resources.analyser = null;
  }, [cleanupMeter]);

  const closeSocket = useCallback(() => {
    const resources = runtime.current;
    resources.intentionalClose = true;
    if (resources.reconnectTimer) clearTimeout(resources.reconnectTimer);
    resources.reconnectTimer = null;
    if (resources.socket && resources.socket.readyState < WebSocket.CLOSING) {
      resources.socket.close(1000, "client cleanup");
    }
    resources.socket = null;
    resources.reconnectAttempts = 0;
    resources.resumeCaptureAfterReconnect = false;
    for (const waiter of resources.controlAckWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("AUDIO_SOCKET_CLOSED"));
    }
    resources.controlAckWaiters.clear();
    replay.current.clear();
    if (mounted.current) setConnection("CLOSED");
  }, []);

  const sendControlAndWait = useCallback(
    (
      socket: WebSocket,
      message: AudioControlMessage,
      timeoutMs = 4_000,
    ): Promise<void> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          runtime.current.controlAckWaiters.delete(message.correlationId);
          reject(new Error(`${message.type} 확인 시간이 초과되었습니다.`));
        }, timeoutMs);
        runtime.current.controlAckWaiters.set(message.correlationId, {
          resolve,
          reject,
          timer,
        });
        socket.send(JSON.stringify(message));
      }),
    [],
  );

  const waitForAudioAck = useCallback(
    (targetSeq: number, timeoutMs = 2_000): Promise<void> =>
      new Promise((resolve, reject) => {
        const startedAt = performance.now();
        const check = () => {
          if (runtime.current.lastAckedAudioSeq >= targetSeq) {
            resolve();
            return;
          }
          if (performance.now() - startedAt >= timeoutMs) {
            reject(new Error("마지막 오디오 chunk 확인 시간이 초과되었습니다."));
            return;
          }
          setTimeout(check, 25);
        };
        check();
      }),
    [],
  );

  const stop = useCallback(() => {
    const resources = runtime.current;
    if (
      resources.socket?.readyState === WebSocket.OPEN &&
      resources.audioSessionId
    ) {
      const message: AudioControlMessage = {
        protocolVersion: AUDIO_PROTOCOL_VERSION,
        type: "audio.stop",
        correlationId: crypto.randomUUID(),
        audioSessionId: resources.audioSessionId,
        interviewId,
      };
      resources.socket.send(JSON.stringify(message));
    }
    cleanupMedia();
    closeSocket();
    runtime.current.audioSessionId = null;
    if (mounted.current) {
      setUxState("IDLE");
      setInterimTranscript("");
    }
  }, [cleanupMedia, closeSocket, interviewId]);

  const startMeter = useCallback(() => {
    const analyser = runtime.current.analyser;
    if (!analyser) return;
    const values = new Uint8Array(analyser.fftSize);
    const tick = () => {
      if (!mounted.current || !runtime.current.analyser) return;
      runtime.current.analyser.getByteTimeDomainData(values);
      let energy = 0;
      for (const value of values) {
        const normalized = (value - 128) / 128;
        energy += normalized * normalized;
      }
      const measuredLevel = Math.min(1, Math.sqrt(energy / values.length) * 3.2);
      setLevel(measuredLevel);
      const now = performance.now();
      if (measuredLevel >= 0.08) {
        speechDetected.current = true;
        lastVoiceAt.current = now;
      } else if (
        autoEndOnSilence &&
        speechDetected.current &&
        lastVoiceAt.current !== null &&
        now - lastVoiceAt.current >= silenceThresholdMs &&
        !autoFinalizeTriggered.current
      ) {
        autoFinalizeTriggered.current = true;
        void endTurnCallback.current();
        return;
      }
      runtime.current.animationFrame = requestAnimationFrame(tick);
    };
    tick();
  }, [autoEndOnSilence, silenceThresholdMs]);

  const handleSocketMessage = useCallback((event: MessageEvent<string>) => {
    try {
      const message = parseAudioServerMessage(event.data);
      if (message.type === "audio.ack") {
        if (message.correlationId) {
          const waiter = runtime.current.controlAckWaiters.get(message.correlationId);
          if (waiter) {
            clearTimeout(waiter.timer);
            runtime.current.controlAckWaiters.delete(message.correlationId);
            waiter.resolve();
          }
        }
        runtime.current.lastAckedAudioSeq = Math.max(
          runtime.current.lastAckedAudioSeq,
          message.lastAudioSeq,
        );
        replay.current.acknowledge(message.lastAudioSeq);
        return;
      }
      if (message.type === "vad.speech_started") {
        setUxState("LISTENING");
        return;
      }
      if (message.type === "vad.speech_stopped") {
        realtimeLatencyTelemetry.markSpeechEnded(message.audioSessionId);
        setUxState("TRANSCRIBING");
        return;
      }
      if (message.type === "stt.partial") {
        setProviderLabel(message.provider);
        setInterimTranscript(message.text);
        return;
      }
      if (message.type === "stt.recognized") {
        realtimeLatencyTelemetry.markRecognized(
          message.audioSessionId,
          message.provider,
        );
        setProviderLabel(message.provider);
        setInterimTranscript("");
        setFinalTranscript(message.text);
        setUxState("AI_THINKING");
        cleanupMedia();
        void Promise.resolve(recognizedCallback.current?.(message.text)).catch(
          (caught: unknown) => {
            if (!mounted.current) return;
            setError(friendlyMicrophoneError(caught));
          },
        );
        return;
      }
      if (message.type === "stt.final") {
        realtimeLatencyTelemetry.markProcessingResult(message.audioSessionId, {
          status: message.processingStatus,
        });
        setProviderLabel(message.provider);
        setInterimTranscript("");
        setFinalTranscript(message.text);
        setUxState("AI_THINKING");
        cleanupMedia();
        closeSocket();
        if (message.processingStatus !== "APPLIED") {
          setError(
            message.processingStatus === "RETRYABLE_FAILURE"
              ? "말씀은 저장됐지만 AI 정리가 잠시 지연되고 있어요. 화면에서 다시 시도할 수 있습니다."
              : "말씀은 저장됐지만 AI 정리를 적용하지 못했습니다. 담당자 확인이 필요합니다.",
          );
          setUxState("ERROR");
        }
        void Promise.resolve(finalCallback.current?.(message.text))
          .catch((caught: unknown) => {
            if (!mounted.current) return;
            setError(friendlyMicrophoneError(caught));
            setUxState("ERROR");
          })
          .finally(() => {
            if (mounted.current) {
              setUxState((current) =>
                current === "AI_THINKING" && message.processingStatus === "APPLIED"
                  ? "IDLE"
                  : current,
              );
            }
          });
        return;
      }
      if (message.type === "audio.error") {
        setError(message.message);
        setUxState("ERROR");
        if (!message.retryable) {
          cleanupMedia();
          closeSocket();
        }
      }
    } catch (caught) {
      setError(friendlyMicrophoneError(caught));
      setUxState("ERROR");
    }
  }, [cleanupMedia, closeSocket]);

  const openSocket = useCallback(
    (audioSessionId: string): Promise<WebSocket> =>
      new Promise((resolve, reject) => {
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        const socket = new WebSocket(
          `${protocol}//${window.location.host}/ws/interviews/${encodeURIComponent(interviewId)}/audio`,
        );
        runtime.current.socket = socket;
        runtime.current.intentionalClose = false;
        setConnection("CONNECTING");
        const timeout = window.setTimeout(() => {
          socket.close();
          reject(new Error("음성 서버 연결 시간이 초과되었습니다."));
        }, 5_000);
        socket.onopen = () => {
          window.clearTimeout(timeout);
          setConnection("OPEN");
          resolve(socket);
        };
        socket.onmessage = handleSocketMessage;
        socket.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error("음성 서버에 연결하지 못했습니다."));
        };
        socket.onclose = () => {
          window.clearTimeout(timeout);
          if (!mounted.current || runtime.current.intentionalClose) return;
          reconnectCallback.current(audioSessionId);
        };
      }),
    [handleSocketMessage, interviewId],
  );

  const reconnectSocket = useCallback(
    (audioSessionId: string) => {
      const resources = runtime.current;
      if (!shouldScheduleAudioReconnect({
        intentionalClose: resources.intentionalClose,
        currentAudioSessionId: resources.audioSessionId,
        requestedAudioSessionId: audioSessionId,
        reconnectAlreadyScheduled: resources.reconnectTimer !== null,
      })) return;
      if (resources.reconnectAttempts >= 3) {
        setConnection("ERROR");
        setError("음성 연결 복구에 실패했습니다. 녹음은 중지되었으며 텍스트로 계속할 수 있습니다.");
        cleanupMedia();
        setUxState("ERROR");
        return;
      }
      if (resources.reconnectAttempts === 0) {
        resources.resumeCaptureAfterReconnect = resources.recorder?.state === "recording";
      }
      resources.reconnectAttempts += 1;
      if (resources.recorder?.state === "recording") resources.recorder.pause();
      cleanupMeter();
      setConnection("RECONNECTING");
      setUxState("PAUSED");
      resources.reconnectTimer = setTimeout(() => {
        const latest = runtime.current;
        latest.reconnectTimer = null;
        if (
          latest.intentionalClose ||
          latest.audioSessionId !== audioSessionId
        ) return;
        void openSocket(audioSessionId)
          .then((socket) => {
            const current = runtime.current;
            if (!current.mimeType || current.audioSessionId !== audioSessionId) {
              throw new Error("AUDIO_RECONNECT_SESSION_CHANGED");
            }
            const resumeMessage = {
              protocolVersion: AUDIO_PROTOCOL_VERSION,
              type: "audio.start",
              correlationId: crypto.randomUUID(),
              audioSessionId,
              interviewId,
              mimeType: current.mimeType,
              lastAckedAudioSeq: current.lastAckedAudioSeq,
            } satisfies AudioControlMessage;
            return sendControlAndWait(socket, resumeMessage).then(() => ({ socket, current }));
          })
          .then(({ socket, current }) => {
            if (current.intentionalClose || current.audioSessionId !== audioSessionId || socket.readyState !== WebSocket.OPEN) return;
            for (const chunk of replay.current.after(current.lastAckedAudioSeq)) {
              socket.send(chunk.frame);
            }
            current.reconnectAttempts = 0;
            if (current.resumeCaptureAfterReconnect && current.recorder?.state === "paused") current.recorder.resume();
            setError(null);
            setUxState(current.resumeCaptureAfterReconnect ? "LISTENING" : "PAUSED");
            if (current.resumeCaptureAfterReconnect) startMeter();
          })
          .catch(() => reconnectCallback.current(audioSessionId));
      }, Math.min(4_000, 500 * 2 ** resources.reconnectAttempts));
    }, [cleanupMedia, cleanupMeter, interviewId, openSocket, sendControlAndWait, startMeter],
  );

  useEffect(() => {
    reconnectCallback.current = reconnectSocket;
  }, [reconnectSocket]);

  const start = useCallback(async () => {
    if (
      disabled ||
      !isSupported ||
      !(["IDLE", "ERROR"] as AudioUxState[]).includes(uxState)
    ) return;
    cleanupMedia();
    closeSocket();
    setError(null);
    setFinalTranscript("");
    setInterimTranscript("");
    try {
      const selectedMimeType = selectSupportedAudioMimeType((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      if (!selectedMimeType) {
        throw new Error(
          "이 브라우저와 서버가 함께 지원하는 음성 형식이 없습니다. 텍스트로 진행해 주세요.",
        );
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
      runtime.current.stream = stream;
      runtime.current.mimeType = selectedMimeType;
      setMimeType(selectedMimeType);

      const AudioContextConstructor =
        window.AudioContext ??
        (window as typeof window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (AudioContextConstructor) {
        const context = new AudioContextConstructor();
        const source = context.createMediaStreamSource(stream);
        const analyser = context.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        runtime.current.context = context;
        runtime.current.analyser = analyser;
      }

      const audioSessionId = crypto.randomUUID();
      realtimeLatencyTelemetry.beginAudioTurn(audioSessionId);
      runtime.current.audioSessionId = audioSessionId;
      runtime.current.audioSeq = 0;
      runtime.current.lastAckedAudioSeq = 0;
      runtime.current.reconnectAttempts = 0;
      speechDetected.current = false;
      lastVoiceAt.current = null;
      autoFinalizeTriggered.current = false;
      const socket = await openSocket(audioSessionId);
      const startMessage: AudioControlMessage = {
        protocolVersion: AUDIO_PROTOCOL_VERSION,
        type: "audio.start",
        correlationId: crypto.randomUUID(),
        audioSessionId,
        interviewId,
        mimeType: selectedMimeType,
        lastAckedAudioSeq: 0,
      };
      await sendControlAndWait(socket, startMessage);

      const recorder = new MediaRecorder(stream, { mimeType: selectedMimeType });
      runtime.current.recorder = recorder;
      recorder.addEventListener("dataavailable", (chunk) => {
        if (chunk.data.size === 0) return;
        const pending = chunk.data.arrayBuffer().then((audio) => {
          const current = runtime.current;
          if (
            !current.audioSessionId ||
            !current.mimeType ||
            current.socket?.readyState !== WebSocket.OPEN
          ) {
            return;
          }
          if (current.socket.bufferedAmount > MAX_WS_BUFFERED_BYTES) {
            if (current.recorder?.state === "recording") current.recorder.pause();
            current.socket.send(
              JSON.stringify({
                protocolVersion: AUDIO_PROTOCOL_VERSION,
                type: "audio.pause",
                correlationId: crypto.randomUUID(),
                audioSessionId: current.audioSessionId,
                interviewId,
              } satisfies AudioControlMessage),
            );
            setUxState("PAUSED");
            setError("네트워크 전송이 지연되어 녹음을 일시정지했습니다. 텍스트로 전환할 수 있습니다.");
            if (!current.backpressureTimer) {
              const resumeWhenDrained = () => {
                const latest = runtime.current;
                if (
                  latest.socket?.readyState === WebSocket.OPEN &&
                  latest.socket.bufferedAmount < MAX_WS_BUFFERED_BYTES / 4 &&
                  latest.audioSessionId
                ) {
                  latest.socket.send(
                    JSON.stringify({
                      protocolVersion: AUDIO_PROTOCOL_VERSION,
                      type: "audio.resume",
                      correlationId: crypto.randomUUID(),
                      audioSessionId: latest.audioSessionId,
                      interviewId,
                      lastAckedAudioSeq: latest.lastAckedAudioSeq,
                    } satisfies AudioControlMessage),
                  );
                  if (latest.recorder?.state === "paused") latest.recorder.resume();
                  latest.backpressureTimer = null;
                  setError(null);
                  setUxState("LISTENING");
                  startMeter();
                  return;
                }
                latest.backpressureTimer = setTimeout(resumeWhenDrained, 150);
              };
              current.backpressureTimer = setTimeout(resumeWhenDrained, 150);
            }
            return;
          }
          current.audioSeq += 1;
          const frame = encodeAudioFrame(
            {
              protocolVersion: AUDIO_PROTOCOL_VERSION,
              type: "audio.chunk",
              audioSessionId: current.audioSessionId,
              audioSeq: current.audioSeq,
              clientMonotonicMs: performance.now(),
              mimeType: current.mimeType,
            },
            audio,
          );
          replay.current.push({ audioSeq: current.audioSeq, frame });
          current.socket.send(frame);
        });
        runtime.current.pendingChunkSends.add(pending);
        void pending
          .catch((caught) => {
            if (mounted.current) setError(friendlyMicrophoneError(caught));
          })
          .finally(() => runtime.current.pendingChunkSends.delete(pending));
      });
      recorder.start(DEFAULT_AUDIO_CHUNK_MS);
      // Start VAD only after MediaRecorder is actually accepting audio. If the
      // meter runs while the WebSocket handshake is still pending, an early
      // utterance followed by silence can fire endTurn before a recorder
      // exists and permanently consume the one-shot auto-finalize guard.
      startMeter();
      setUxState("LISTENING");
    } catch (caught) {
      cleanupMedia();
      closeSocket();
      setError(friendlyMicrophoneError(caught));
      setUxState("ERROR");
    }
  }, [
    cleanupMedia,
    closeSocket,
    disabled,
    interviewId,
    isSupported,
    openSocket,
    sendControlAndWait,
    startMeter,
    uxState,
  ]);

  const pause = useCallback(() => {
    const resources = runtime.current;
    if (resources.recorder?.state !== "recording") return;
    resources.recorder.pause();
    if (resources.socket?.readyState === WebSocket.OPEN && resources.audioSessionId) {
      resources.socket.send(
        JSON.stringify({
          protocolVersion: AUDIO_PROTOCOL_VERSION,
          type: "audio.pause",
          correlationId: crypto.randomUUID(),
          audioSessionId: resources.audioSessionId,
          interviewId,
        } satisfies AudioControlMessage),
      );
    }
    cleanupMeter();
    setUxState("PAUSED");
  }, [cleanupMeter, interviewId]);

  const resume = useCallback(() => {
    const resources = runtime.current;
    if (resources.recorder?.state !== "paused") return;
    resources.recorder.resume();
    if (resources.socket?.readyState === WebSocket.OPEN && resources.audioSessionId) {
      resources.socket.send(
        JSON.stringify({
          protocolVersion: AUDIO_PROTOCOL_VERSION,
          type: "audio.resume",
          correlationId: crypto.randomUUID(),
          audioSessionId: resources.audioSessionId,
          interviewId,
          lastAckedAudioSeq: resources.lastAckedAudioSeq,
        } satisfies AudioControlMessage),
      );
    }
    setError(null);
    startMeter();
    setUxState("LISTENING");
  }, [interviewId, startMeter]);

  const beginAiSpeaking = useCallback((): boolean => {
    const transition = beginAiSpeakingTransition(uxState);
    if (!transition) return false;
    stateBeforeAiSpeaking.current = transition.restoreState;
    if (transition.pauseCapture) pause();
    setUxState(transition.nextState);
    return true;
  }, [pause, uxState]);

  const endAiSpeaking = useCallback(() => {
    if (uxStateRef.current !== "AI_SPEAKING") return;
    const transition = endAiSpeakingTransition(stateBeforeAiSpeaking.current);
    stateBeforeAiSpeaking.current = "IDLE";
    if (transition.resumeCapture) {
      resume();
      return;
    }
    setUxState(transition.nextState);
  }, [resume]);

  const endTurn = useCallback(async () => {
    const resources = runtime.current;
    if (
      !resources.recorder ||
      !resources.audioSessionId ||
      resources.socket?.readyState !== WebSocket.OPEN
    ) {
      return;
    }
    try {
      setUxState("TRANSCRIBING");
      realtimeLatencyTelemetry.markSpeechEnded(resources.audioSessionId);
      cleanupMeter();
      if (resources.recorder.state === "paused") resources.recorder.resume();
      if (resources.recorder.state !== "inactive") {
        await new Promise<void>((resolve) => {
          resources.recorder?.addEventListener("stop", () => resolve(), { once: true });
          resources.recorder?.stop();
        });
      }
      await Promise.all([...resources.pendingChunkSends]);
      await waitForAudioAck(resources.audioSeq);
      resources.socket.send(
        JSON.stringify({
          protocolVersion: AUDIO_PROTOCOL_VERSION,
          type: "audio.end_turn",
          correlationId: crypto.randomUUID(),
          audioSessionId: resources.audioSessionId,
          interviewId,
          lastAckedAudioSeq: resources.lastAckedAudioSeq,
        } satisfies AudioControlMessage),
      );
    } catch (caught) {
      setError(friendlyMicrophoneError(caught));
      setUxState("ERROR");
      cleanupMedia();
      closeSocket();
    }
  }, [cleanupMedia, cleanupMeter, closeSocket, interviewId, waitForAudioAck]);

  useEffect(() => {
    endTurnCallback.current = endTurn;
  }, [endTurn]);

  useEffect(() => {
    mounted.current = true;
    const handleVisibility = () => {
      if (document.hidden && ["LISTENING", "PAUSED"].includes(uxStateRef.current)) stop();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      mounted.current = false;
      document.removeEventListener("visibilitychange", handleVisibility);
      cleanupMedia();
      closeSocket();
    };
  }, [cleanupMedia, closeSocket, stop]);

  return {
    uxState,
    connection,
    level,
    interimTranscript,
    finalTranscript,
    providerLabel,
    mimeType,
    error,
    isSupported,
    start,
    pause,
    resume,
    beginAiSpeaking,
    endAiSpeaking,
    endTurn,
    stop,
  };
}
