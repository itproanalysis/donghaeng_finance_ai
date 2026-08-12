let sharedQuestionVoiceContext: AudioContext | null = null;

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
