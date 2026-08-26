"use client";

import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  LoaderCircle,
  Maximize2,
  Minimize2,
  Radio,
  Save,
  Sparkles,
} from "lucide-react";

import {
  formatDateTime,
  formatPercent,
  type InformationItemPreviewChangeView,
  type MessageProcessingTelemetryView,
} from "@/components/api-adapter";
import type {
  AudioUxState,
  LiveConnectionState,
  LiveEventEnvelope,
} from "@/realtime/live-store";

export type LiveSaveState = "LOADING" | "SAVING" | "SYNCING" | "SAVED" | "ERROR";

const SAVE_LABELS: Record<LiveSaveState, string> = {
  LOADING: "상태 불러오는 중",
  SAVING: "답변 저장 중",
  SYNCING: "서버 반영 중",
  SAVED: "서버 저장 완료",
  ERROR: "동기화 확인 필요",
};

const CONNECTION_LABELS: Record<LiveConnectionState, string> = {
  CONNECTING: "실시간 연결 중",
  OPEN: "실시간 연결됨",
  RECONNECTING: "재연결 중",
  CLOSED: "실시간 연결 종료",
  ERROR: "실시간 연결 오류",
};

const AUDIO_LABELS: Record<AudioUxState, string> = {
  IDLE: "음성 대기",
  LISTENING: "차주 답변 듣는 중",
  PAUSED: "음성 일시정지",
  TRANSCRIBING: "음성 전사 중",
  AI_THINKING: "답변 정보 반영 중",
  AI_SPEAKING: "AI 질문 재생 중",
  ERROR: "텍스트 입력 가능",
};

const EVENT_LABELS: Record<LiveEventEnvelope["type"], string> = {
  "transcript.finalized": "전사 확정",
  "info.status_changed": "정보 상태 이동",
  "info.value_changed": "정보값 저장",
  "coverage.changed": "진행률 갱신",
  "feature.preview_updated": "피쳐 PREVIEW 갱신",
  "summary.preview_updated": "요약 PREVIEW 갱신",
  "question.generated": "다음 질문 준비",
  "conflict.detected": "정보 충돌 감지",
  ready_to_complete: "완료 조건 충족",
  "evaluation.ready": "평가 생성 완료",
  "transcript.corrected": "전사 수정 반영",
  "interview.completed": "FINAL 저장 완료",
};

export function describeLiveEventType(
  eventType: LiveEventEnvelope["type"] | null,
): string {
  return eventType ? EVENT_LABELS[eventType] : "첫 답변 대기";
}

export function describeMessageProcessingProvider(
  processing: MessageProcessingTelemetryView | null,
): string {
  if (!processing) return "AI 처리 대기";
  const provider =
    processing.provider?.toLowerCase() === "anthropic"
      ? "Claude"
      : processing.provider ?? "AI 제공자 확인 안 됨";
  const model = processing.model === "claude-haiku-4-5-20251001"
    ? "Haiku 4.5 · 실시간"
    : processing.model === "claude-sonnet-5"
      ? "Sonnet 5 · 고품질"
      : processing.model;
  return model ? `${provider} · ${model}` : provider;
}

export function describeMessageProcessingDetail(
  processing: MessageProcessingTelemetryView | null,
): string {
  if (!processing) return "답변 처리 후 실제 모델을 표시합니다";
  const values = [
    processing.status === "APPLIED"
      ? "처리 완료"
      : processing.status === "RETRYABLE_FAILURE"
        ? "분석 실패 · 수동 재처리 가능"
        : "분석 거절 · 재처리 차단",
  ];
  if (processing.inputTokens !== null || processing.outputTokens !== null) {
    const input =
      processing.inputTokens === null
        ? "—"
        : new Intl.NumberFormat("ko-KR").format(processing.inputTokens);
    const output =
      processing.outputTokens === null
        ? "—"
        : new Intl.NumberFormat("ko-KR").format(processing.outputTokens);
    values.push(`입력 ${input} / 출력 ${output} 토큰`);
  }
  if (processing.stopReason) values.push(`종료 ${processing.stopReason}`);
  return values.join(" · ");
}

function SaveStateIcon({ state }: { state: LiveSaveState }) {
  if (state === "ERROR") return <AlertTriangle size={17} aria-hidden="true" />;
  if (state === "SAVED") return <CheckCircle2 size={17} aria-hidden="true" />;
  return <LoaderCircle className="spin" size={17} aria-hidden="true" />;
}

interface LiveRealtimeStatusProps {
  overallRate: number | null;
  resolvedRequired: number | null;
  totalRequired: number | null;
  saveState: LiveSaveState;
  connection: LiveConnectionState;
  version: number;
  lastEventSeq: number;
  updatedAt: string | null;
  lastObservedEventType: LiveEventEnvelope["type"] | null;
  lastObservedEventAt: string | null;
  recentEventTypes: readonly LiveEventEnvelope["type"][];
  batchPending: boolean;
  batchIndex: number | null;
  batchSize: number | null;
  audioState: AudioUxState;
  audioProvider: string | null;
  messageProcessing: MessageProcessingTelemetryView | null;
  changes: readonly InformationItemPreviewChangeView[];
  liveSummary: string | null;
  goalSummary: string | null;
  presentationMode: boolean;
  onTogglePresentation: () => void;
}

export function LiveRealtimeStatus({
  overallRate,
  resolvedRequired,
  totalRequired,
  saveState,
  connection,
  version,
  lastEventSeq,
  updatedAt,
  lastObservedEventType,
  lastObservedEventAt,
  recentEventTypes,
  batchPending,
  batchIndex,
  batchSize,
  audioState,
  audioProvider,
  messageProcessing,
  changes,
  liveSummary,
  goalSummary,
  presentationMode,
  onTogglePresentation,
}: LiveRealtimeStatusProps) {
  const batchLabel =
    batchPending && batchIndex !== null && batchSize !== null
      ? `처리 ${Math.min(batchIndex + 1, batchSize)} / ${batchSize}`
      : null;
  const connectionHealthy = connection === "OPEN";

  return (
    <section className="live-realtime-status" aria-label="실시간 인터뷰 상태">
      <div className="live-realtime-status__main">
        <div className="live-progress-status">
          <div>
            <span><Activity size={15} aria-hidden="true" /> 인터뷰 진행</span>
            <strong>{formatPercent(overallRate)}</strong>
          </div>
          <div className="live-progress-track" aria-hidden="true">
            <span style={{ width: overallRate === null ? "0%" : `${overallRate}%` }} />
          </div>
          <small>{resolvedRequired ?? "—"} / {totalRequired ?? "—"} 필수정보 확인</small>
        </div>

        <div className="live-status-cell" data-state={connection.toLowerCase()}>
          <Radio className={connectionHealthy ? "pulse" : undefined} size={17} aria-hidden="true" />
          <div>
            <span>{CONNECTION_LABELS[connection]}</span>
            <small>SSE 이벤트 #{lastEventSeq}</small>
          </div>
        </div>

        <div className="live-status-cell" data-state={saveState.toLowerCase()}>
          <SaveStateIcon state={saveState} />
          <div>
            <span>{SAVE_LABELS[saveState]}</span>
            <small>snapshot v{version} · {updatedAt ? formatDateTime(updatedAt) : "시각 확인 중"}</small>
          </div>
        </div>

        <div
          className="live-status-cell live-status-cell--ai"
          data-state={messageProcessing?.status.toLowerCase() ?? "waiting"}
        >
          <Sparkles size={17} aria-hidden="true" />
          <div>
            <span>{describeMessageProcessingProvider(messageProcessing)}</span>
            <small>{describeMessageProcessingDetail(messageProcessing)}</small>
          </div>
        </div>

        <div className="live-status-cell" data-state={audioState.toLowerCase()}>
          <Save size={17} aria-hidden="true" />
          <div>
            <span>{AUDIO_LABELS[audioState]}</span>
            <small>{audioProvider ?? "텍스트·음성 입력 준비"}</small>
          </div>
        </div>

        <button
          className="live-presentation-toggle"
          type="button"
          aria-pressed={presentationMode}
          onClick={onTogglePresentation}
          title={presentationMode ? "전체 정보 화면으로 전환" : "집중 보기로 전환"}
        >
          {presentationMode ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          {presentationMode ? "전체 보기" : "집중 보기"}
        </button>
      </div>

      <div className="live-realtime-status__activity" aria-live="polite">
        <div className="live-event-stage" data-active={batchPending ? "true" : undefined}>
          <span>실시간 처리</span>
          <strong>
            {batchLabel ??
              (lastObservedEventType
                ? describeLiveEventType(lastObservedEventType)
                : lastEventSeq > 0
                  ? "최신 상태 동기화 완료"
                  : "첫 답변 대기")}
          </strong>
          <small>
            {recentEventTypes.length > 0
              ? recentEventTypes.slice(-4).map(describeLiveEventType).join(" → ")
              : lastObservedEventAt
                ? formatDateTime(lastObservedEventAt)
                : updatedAt
                  ? formatDateTime(updatedAt)
                  : "서버 이벤트 수신 대기"}
          </small>
        </div>

        <div className="live-change-list">
          <span>이번 답변 반영</span>
          {changes.length > 0 ? (
            changes.slice(0, 4).map((change) => (
              <strong data-bucket={change.currentBucket} key={change.infoCode}>
                {change.label}
                <small>{change.currentStatusLabel}</small>
              </strong>
            ))
          ) : (
            <small>답변 후 완료·추가확인 카드 이동을 여기에 표시합니다.</small>
          )}
          {changes.length > 4 && <small>외 {changes.length - 4}건</small>}
        </div>

        <div className="live-live-summary">
          {goalSummary && <strong>GOAL {goalSummary}</strong>}
          <p>
            <span>LIVE SUMMARY</span>
            {liveSummary ?? "확정된 답변이 쌓이면 서버 요약이 실시간으로 갱신됩니다."}
          </p>
        </div>
      </div>
    </section>
  );
}
