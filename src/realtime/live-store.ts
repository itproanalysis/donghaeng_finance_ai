import type { LiveInterviewSnapshot } from "@/domain";

export const LIVE_CONNECTION_STATES = [
  "CONNECTING",
  "OPEN",
  "RECONNECTING",
  "CLOSED",
  "ERROR",
] as const;

export type LiveConnectionState = (typeof LIVE_CONNECTION_STATES)[number];

export const AUDIO_UX_STATES = [
  "IDLE",
  "LISTENING",
  "PAUSED",
  "TRANSCRIBING",
  "AI_THINKING",
  "AI_SPEAKING",
  "ERROR",
] as const;

export type AudioUxState = (typeof AUDIO_UX_STATES)[number];

export interface LiveEventEnvelope {
  eventId: string;
  seq: number;
  interviewId: string;
  aggregateVersion: number;
  snapshotType: "PREVIEW" | "FINAL";
  occurredAt: string;
  turnId: string;
  batchIndex: number;
  batchSize: number;
  isBatchFinal: boolean;
  snapshotUrl: string;
  type:
    | "transcript.finalized"
    | "info.status_changed"
    | "info.value_changed"
    | "coverage.changed"
    | "feature.preview_updated"
    | "summary.preview_updated"
    | "question.generated"
    | "conflict.detected"
    | "ready_to_complete"
    | "evaluation.ready"
    | "transcript.corrected"
    | "interview.completed";
  data: Record<string, unknown>;
}

export interface SerializableAudioState {
  uxState: AudioUxState;
  connection: LiveConnectionState;
  audioSessionId: string | null;
  mimeType: string | null;
  lastAckedAudioSeq: number;
  level: number;
  interimTranscript: string;
  providerLabel: string | null;
  error: string | null;
}

export interface InterviewLiveState {
  snapshot: LiveInterviewSnapshot | null;
  sseConnection: LiveConnectionState;
  lastEventSeq: number;
  lastAggregateVersion: number;
  lastObservedEventType: LiveEventEnvelope["type"] | null;
  lastObservedEventAt: string | null;
  currentBatchIndex: number | null;
  currentBatchSize: number | null;
  currentBatchFinal: boolean | null;
  batchPending: boolean;
  needsResync: boolean;
  audio: SerializableAudioState;
}

export type InterviewLiveAction =
  | { type: "snapshot.hydrated"; snapshot: LiveInterviewSnapshot; lastEventSeq?: number }
  | { type: "snapshot.version_hydrated"; version: number; lastEventSeq: number }
  | { type: "sse.connection_changed"; connection: LiveConnectionState }
  | { type: "server.event_received"; event: LiveEventEnvelope }
  | { type: "resync.completed"; snapshot: LiveInterviewSnapshot; lastEventSeq: number }
  | { type: "resync.version_completed"; version: number; lastEventSeq: number }
  | { type: "audio.state_changed"; patch: Partial<SerializableAudioState> }
  | { type: "audio.reset" };

export const INITIAL_AUDIO_STATE: SerializableAudioState = {
  uxState: "IDLE",
  connection: "CLOSED",
  audioSessionId: null,
  mimeType: null,
  lastAckedAudioSeq: 0,
  level: 0,
  interimTranscript: "",
  providerLabel: null,
  error: null,
};

export const INITIAL_INTERVIEW_LIVE_STATE: InterviewLiveState = {
  snapshot: null,
  sseConnection: "CLOSED",
  lastEventSeq: 0,
  lastAggregateVersion: 0,
  lastObservedEventType: null,
  lastObservedEventAt: null,
  currentBatchIndex: null,
  currentBatchSize: null,
  currentBatchFinal: null,
  batchPending: false,
  needsResync: false,
  audio: INITIAL_AUDIO_STATE,
};

/**
 * The durable server snapshot remains authoritative. Events only signal that a
 * newer aggregate version exists; the hook performs one snapshot refresh after
 * a committed event batch. This prevents partially applying a multi-projection
 * turn in the browser.
 */
export function interviewLiveReducer(
  state: InterviewLiveState,
  action: InterviewLiveAction,
): InterviewLiveState {
  switch (action.type) {
    case "snapshot.hydrated":
      return {
        ...state,
        snapshot: action.snapshot,
        lastEventSeq: action.lastEventSeq ?? state.lastEventSeq,
        lastAggregateVersion: action.snapshot.session.version,
        batchPending: false,
        needsResync: false,
      };
    case "snapshot.version_hydrated":
      return {
        ...state,
        lastEventSeq: Math.max(state.lastEventSeq, action.lastEventSeq),
        lastAggregateVersion: Math.max(state.lastAggregateVersion, action.version),
        batchPending: false,
        needsResync: false,
      };
    case "resync.completed":
      return {
        ...state,
        snapshot: action.snapshot,
        lastEventSeq: action.lastEventSeq,
        lastAggregateVersion: action.snapshot.session.version,
        batchPending: false,
        needsResync: false,
      };
    case "resync.version_completed":
      return {
        ...state,
        lastEventSeq: Math.max(state.lastEventSeq, action.lastEventSeq),
        lastAggregateVersion: Math.max(state.lastAggregateVersion, action.version),
        batchPending: false,
        needsResync: false,
      };
    case "sse.connection_changed":
      return { ...state, sseConnection: action.connection };
    case "server.event_received": {
      const { event } = action;
      if (event.seq <= state.lastEventSeq) return state;

      const sequenceGap = event.seq !== state.lastEventSeq + 1;
      const versionGap = event.aggregateVersion > state.lastAggregateVersion + 1;
      return {
        ...state,
        lastEventSeq: event.seq,
        lastAggregateVersion: Math.max(
          state.lastAggregateVersion,
          event.aggregateVersion,
        ),
        lastObservedEventType: event.type,
        lastObservedEventAt: event.occurredAt,
        currentBatchIndex: event.batchIndex,
        currentBatchSize: event.batchSize,
        currentBatchFinal: event.isBatchFinal,
        batchPending: true,
        needsResync:
          state.needsResync ||
          sequenceGap ||
          versionGap ||
          (event.isBatchFinal &&
            event.aggregateVersion > (state.snapshot?.session.version ?? 0)),
      };
    }
    case "audio.state_changed":
      return { ...state, audio: { ...state.audio, ...action.patch } };
    case "audio.reset":
      return { ...state, audio: INITIAL_AUDIO_STATE };
  }
}
