export interface InterviewActivitySnapshot {
  activeTurn: boolean;
  finalTranscriptPending: boolean;
  activeAudioSessionIds: string[];
  pendingAudioSessionIds: string[];
}

interface MutableInterviewActivity {
  activeAudioSessionIds: Set<string>;
  pendingAudioSessionIds: Set<string>;
}

const activityGlobals = globalThis as typeof globalThis & {
  __donghaengInterviewActivities?: Map<string, MutableInterviewActivity>;
};

function activities(): Map<string, MutableInterviewActivity> {
  activityGlobals.__donghaengInterviewActivities ??= new Map();
  return activityGlobals.__donghaengInterviewActivities;
}

function stateFor(interviewId: string): MutableInterviewActivity {
  const existing = activities().get(interviewId);
  if (existing) return existing;
  const created: MutableInterviewActivity = {
    activeAudioSessionIds: new Set(),
    pendingAudioSessionIds: new Set(),
  };
  activities().set(interviewId, created);
  return created;
}

function prune(interviewId: string, state: MutableInterviewActivity): void {
  if (
    state.activeAudioSessionIds.size === 0 &&
    state.pendingAudioSessionIds.size === 0
  ) {
    activities().delete(interviewId);
  }
}

/**
 * Process-local PREVIEW activity gate. The custom server and Next route handlers share
 * globalThis in the supported single-process dev-v1 runtime. A distributed registry is
 * still required before multi-instance deployment.
 */
export const interviewActivityRegistry = {
  beginTurn(interviewId: string, audioSessionId: string): void {
    const state = stateFor(interviewId);
    state.activeAudioSessionIds.add(audioSessionId);
    state.pendingAudioSessionIds.delete(audioSessionId);
  },

  markFinalTranscriptPending(interviewId: string, audioSessionId: string): void {
    const state = stateFor(interviewId);
    state.activeAudioSessionIds.add(audioSessionId);
    state.pendingAudioSessionIds.add(audioSessionId);
  },

  finishTurn(interviewId: string, audioSessionId: string): void {
    const state = activities().get(interviewId);
    if (!state) return;
    state.activeAudioSessionIds.delete(audioSessionId);
    state.pendingAudioSessionIds.delete(audioSessionId);
    prune(interviewId, state);
  },

  snapshot(interviewId: string): InterviewActivitySnapshot {
    const state = activities().get(interviewId);
    const activeAudioSessionIds = [...(state?.activeAudioSessionIds ?? [])].sort();
    const pendingAudioSessionIds = [...(state?.pendingAudioSessionIds ?? [])].sort();
    return {
      activeTurn: activeAudioSessionIds.length > 0,
      finalTranscriptPending: pendingAudioSessionIds.length > 0,
      activeAudioSessionIds,
      pendingAudioSessionIds,
    };
  },

  resetForTests(): void {
    activities().clear();
  },
};
