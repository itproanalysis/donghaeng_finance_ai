"use client";

import {
  CircleStop,
  Mic,
  Pause,
  Play,
  Square,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  ApiRequestError,
  authenticatedFetch,
  readApiEnvelope,
} from "@/components/api-adapter";
import { useAudioInterview } from "@/realtime/use-audio-interview";
import type { AudioUxState, LiveConnectionState } from "@/realtime/live-store";

export interface AudioInterviewStatus {
  uxState: AudioUxState;
  connection: LiveConnectionState;
  providerLabel: string | null;
}

interface AudioInterviewControlsProps {
  interviewId: string;
  currentQuestion: string | null;
  disabled: boolean;
  onServerFinal: (text: string) => void | Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  onStatusChange?: (status: AudioInterviewStatus) => void;
  showQuestionVoiceControl?: boolean;
  borrowerMode?: boolean;
}

const STATE_LABELS = {
  IDLE: "음성 대기",
  LISTENING: "듣는 중",
  PAUSED: "일시정지",
  TRANSCRIBING: "전사 중",
  AI_THINKING: "정보 반영 중",
  AI_SPEAKING: "질문 재생 중",
  ERROR: "텍스트 전환 가능",
} as const;

const MICROPHONE_CONSENT_VERSION = "microphone-interview-v1";
const CLOUD_AI_CONSENT_VERSION = "cloud-ai-processing-v1";

export function AudioInterviewControls({
  interviewId,
  currentQuestion,
  disabled,
  onServerFinal,
  onBusyChange,
  onStatusChange,
  showQuestionVoiceControl = true,
  borrowerMode = false,
}: AudioInterviewControlsProps) {
  const [autoEndOnSilence, setAutoEndOnSilence] = useState(false);
  const audio = useAudioInterview({
    interviewId,
    disabled,
    autoEndOnSilence,
    silenceThresholdMs: 1_000,
    onFinalTranscript: onServerFinal,
  });
  const endAiSpeaking = audio.endAiSpeaking;
  const [voiceQuestionEnabled, setVoiceQuestionEnabled] = useState(false);
  const utterance = useRef<SpeechSynthesisUtterance | null>(null);
  const consentDialog = useRef<HTMLElement | null>(null);
  const consentAgreeButton = useRef<HTMLButtonElement | null>(null);
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentSubmitting, setConsentSubmitting] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      window.speechSynthesis?.cancel();
      utterance.current = null;
      endAiSpeaking();
    };
  }, [currentQuestion, endAiSpeaking]);

  useEffect(() => {
    if (!consentOpen) return;
    consentAgreeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !consentSubmitting) {
        setConsentOpen(false);
        return;
      }
      if (event.key !== "Tab" || !consentDialog.current) return;
      const focusable = Array.from(
        consentDialog.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [consentOpen, consentSubmitting]);

  function toggleQuestionVoice() {
    if (voiceQuestionEnabled) {
      window.speechSynthesis?.cancel();
      utterance.current = null;
      setVoiceQuestionEnabled(false);
      audio.endAiSpeaking();
      return;
    }
    if (!currentQuestion || !("speechSynthesis" in window)) return;
    if (!audio.beginAiSpeaking()) return;
    const spoken = new SpeechSynthesisUtterance(currentQuestion);
    spoken.lang = "ko-KR";
    spoken.rate = 0.95;
    spoken.onerror = () => {
      setVoiceQuestionEnabled(false);
      audio.endAiSpeaking();
    };
    spoken.onend = () => {
      setVoiceQuestionEnabled(false);
      audio.endAiSpeaking();
    };
    utterance.current = spoken;
    setVoiceQuestionEnabled(true);
    try {
      window.speechSynthesis.speak(spoken);
    } catch {
      utterance.current = null;
      setVoiceQuestionEnabled(false);
      audio.endAiSpeaking();
    }
  }

  function stopQuestionVoice() {
    if (voiceQuestionEnabled) {
      window.speechSynthesis?.cancel();
      utterance.current = null;
      setVoiceQuestionEnabled(false);
      audio.endAiSpeaking();
    }
  }

  async function beginMicrophoneCapture() {
    stopQuestionVoice();
    await audio.start();
  }

  async function startMicrophone() {
    stopQuestionVoice();
    setConsentError(null);
    setConsentSubmitting(true);
    try {
      const consentUrl = `/api/interviews/${encodeURIComponent(interviewId)}/consents`;
      const [microphoneResponse, cloudAiResponse] = await Promise.all([
        authenticatedFetch(`${consentUrl}?require=MICROPHONE_INTERVIEW`, {
          cache: "no-store",
        }),
        authenticatedFetch(`${consentUrl}?require=CLOUD_AI_PROCESSING`, {
          cache: "no-store",
        }),
      ]);
      await Promise.all([
        readApiEnvelope(microphoneResponse),
        readApiEnvelope(cloudAiResponse),
      ]);
      await beginMicrophoneCapture();
    } catch (caught) {
      if (
        caught instanceof ApiRequestError &&
        [
          "MICROPHONE_CONSENT_REQUIRED",
          "CLOUD_AI_PROCESSING_CONSENT_REQUIRED",
        ].includes(caught.code ?? "")
      ) {
        setConsentOpen(true);
      } else {
        setConsentError(
          caught instanceof Error
            ? caught.message
            : "마이크 동의 상태를 확인하지 못했습니다.",
        );
      }
    } finally {
      setConsentSubmitting(false);
    }
  }

  async function recordMicrophoneConsent(granted: boolean) {
    setConsentSubmitting(true);
    setConsentError(null);
    try {
      const response = await authenticatedFetch(
        `/api/interviews/${encodeURIComponent(interviewId)}/consents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            purpose: "MICROPHONE_INTERVIEW",
            consentVersion: MICROPHONE_CONSENT_VERSION,
            granted,
            expiresAt: null,
          }),
        },
      );
      await readApiEnvelope(response);
      if (granted) {
        const cloudAiResponse = await authenticatedFetch(
          `/api/interviews/${encodeURIComponent(interviewId)}/consents`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              purpose: "CLOUD_AI_PROCESSING",
              consentVersion: CLOUD_AI_CONSENT_VERSION,
              granted: true,
              expiresAt: null,
            }),
          },
        );
        await readApiEnvelope(cloudAiResponse);
      }
      setConsentOpen(false);
      if (granted) await beginMicrophoneCapture();
    } catch (caught) {
      setConsentError(
        caught instanceof Error ? caught.message : "마이크 동의를 기록하지 못했습니다.",
      );
    } finally {
      setConsentSubmitting(false);
    }
  }

  const captureActive = ["LISTENING", "PAUSED", "TRANSCRIBING"].includes(
    audio.uxState,
  );
  const busy =
    captureActive ||
    audio.uxState === "AI_THINKING" ||
    audio.uxState === "AI_SPEAKING";

  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);

  useEffect(() => {
    onStatusChange?.({
      uxState: audio.uxState,
      connection: audio.connection,
      providerLabel: audio.providerLabel,
    });
  }, [audio.connection, audio.providerLabel, audio.uxState, onStatusChange]);

  return (
    <section className="audio-controls" aria-label="음성 답변 컨트롤">
      {consentOpen && (
        <div className="completion-modal" role="presentation">
          <section
            ref={consentDialog}
            className="completion-dialog microphone-consent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="microphone-consent-title"
            aria-describedby="microphone-consent-description"
          >
            <div className="completion-dialog__heading">
              <div>
                <p className="panel-kicker">MICROPHONE CONSENT · v1</p>
                <h2 id="microphone-consent-title">음성 답변 처리 동의</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setConsentOpen(false)}
                disabled={consentSubmitting}
                aria-label="마이크 동의 창 닫기"
              >
                ×
              </button>
            </div>
            <div className="microphone-consent-dialog__body">
              <p id="microphone-consent-description">
                마이크 음성은 현재 질문의 답변을 실시간 전사하기 위해서만 전송됩니다.
                원본 오디오는 저장하지 않으며, 확정된 전사문·처리 시각·STT 제공자 정보만
                인터뷰 근거로 보존합니다. 확정 전사와 현재 정보 상태는 설정된 경우 외부
                Claude API에서 구조화·후속질문 생성을 위해 처리됩니다.
              </p>
              <ul>
                <li>승인된 로컬 또는 외부 STT로만 전송되며, 실제 제공자 이름은 연결 후 화면과 근거에 표시됩니다. 준비되지 않았을 때 임의 전사를 만들지 않습니다.</li>
                <li>언제든 음성 답변을 취소하고 텍스트 입력으로 계속할 수 있습니다.</li>
                <li>원음 저장에는 별도 동의가 필요하며 이 화면에서는 요청하지 않습니다.</li>
                <li>Claude는 대출 승인·거절이나 신용등급을 결정하지 않고, 서버 규칙이 모든 구조화 결과를 다시 검증합니다.</li>
              </ul>
              {consentError && <p className="audio-controls__error" role="alert">{consentError}</p>}
              <div className="microphone-consent-dialog__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  onClick={() => void recordMicrophoneConsent(false)}
                  disabled={consentSubmitting}
                >
                  동의하지 않고 텍스트 사용
                </button>
                <button
                  ref={consentAgreeButton}
                  type="button"
                  className="button button--primary"
                  onClick={() => void recordMicrophoneConsent(true)}
                  disabled={consentSubmitting}
                >
                  <Mic size={17} /> 동의하고 마이크 시작
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
      <div className="audio-controls__header">
        <div>
          <span className="audio-controls__state" data-state={audio.uxState.toLowerCase()}>
            {STATE_LABELS[audio.uxState]}
          </span>
          <small>
            {audio.connection === "OPEN" ? "음성 서버 연결됨" : "텍스트 입력은 항상 사용 가능"}
          </small>
        </div>
        {showQuestionVoiceControl && <button
          type="button"
          className="icon-button"
          onClick={toggleQuestionVoice}
          disabled={
            !currentQuestion ||
            audio.uxState === "TRANSCRIBING" ||
            audio.uxState === "AI_THINKING"
          }
          aria-label={voiceQuestionEnabled ? "질문 음성 끄기" : "질문 음성으로 듣기"}
          title="질문 음성은 선택 사항이며 실패해도 텍스트가 유지됩니다"
        >
          {voiceQuestionEnabled ? <VolumeX size={17} /> : <Volume2 size={17} />}
        </button>}
      </div>

      <div className="audio-level" aria-label={`마이크 입력 레벨 ${Math.round(audio.level * 100)}%`}>
        {Array.from({ length: 24 }, (_, index) => (
          <span
            key={index}
            data-active={index / 24 < audio.level ? "true" : "false"}
          />
        ))}
      </div>

      {(audio.interimTranscript || audio.finalTranscript) && (
        <div className="audio-caption" aria-live="polite">
          <span>{audio.interimTranscript ? "실시간 자막" : "확정 자막"}</span>
          <p>{audio.interimTranscript || audio.finalTranscript}</p>
        </div>
      )}

      <div className="audio-controls__buttons">
        {["IDLE", "ERROR", "AI_SPEAKING"].includes(audio.uxState) ? (
          <button
            type="button"
            className="button button--audio"
            onClick={() => void startMicrophone()}
            disabled={
              disabled ||
              !audio.isSupported ||
              consentSubmitting ||
              audio.uxState === "AI_SPEAKING"
            }
          >
            <Mic size={17} />
            {audio.uxState === "AI_SPEAKING" ? "질문 재생 중" : "마이크로 답변"}
          </button>
        ) : (
          <>
            {audio.uxState === "LISTENING" ? (
              <button type="button" className="button button--ghost" onClick={audio.pause}>
                <Pause size={16} /> 일시정지
              </button>
            ) : audio.uxState === "PAUSED" ? (
              <button type="button" className="button button--ghost" onClick={audio.resume}>
                <Play size={16} /> 계속 듣기
              </button>
            ) : null}
            <button
              type="button"
              className="button button--audio"
              onClick={() => void audio.endTurn()}
              disabled={audio.uxState === "TRANSCRIBING"}
            >
              <Square size={15} fill="currentColor" /> 답변 끝내기
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={audio.stop}
              title="음성 답변 취소"
              aria-label="음성 답변 취소"
            >
              <CircleStop size={18} />
            </button>
          </>
        )}
      </div>

      {borrowerMode ? (
        <p className="audio-controls__borrower-note">
          <strong>전사한 문장은 사장님 답변으로 바로 반영됩니다.</strong>
          <span>말씀을 마친 뒤 “답변 끝내기”를 눌러 주세요.</span>
        </p>
      ) : (
        <>
          <div className="audio-controls__disclosure">
            <span>{audio.providerLabel ?? "STT 제공자: 연결 후 표시"}</span>
            <span>원본 오디오 저장 안 함</span>
            {audio.mimeType && <span>{audio.mimeType}</span>}
          </div>
          <label className="audio-controls__vad">
            <input
              type="checkbox"
              checked={autoEndOnSilence}
              onChange={(event) => setAutoEndOnSilence(event.target.checked)}
              disabled={captureActive || audio.uxState === "AI_SPEAKING"}
            />
            1초 침묵 후 자동 답변 종료(선택) · 수동 “답변 끝내기”가 항상 우선
          </label>
        </>
      )}
      {audio.error && (
        <p className="audio-controls__error" role="alert">
          <VolumeX size={15} /> {audio.error}
        </p>
      )}
      {!consentOpen && consentError && (
        <p className="audio-controls__error" role="alert">
          <VolumeX size={15} /> {consentError}
        </p>
      )}
      {!audio.isSupported && (
        <p className="audio-controls__error">
          <VolumeX size={15} /> 이 브라우저에서는 음성 캡처를 지원하지 않습니다. 텍스트로 진행해 주세요.
        </p>
      )}
    </section>
  );
}
