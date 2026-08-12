export interface StreamingSttCallbacks {
  onSpeechStarted: () => void;
  onPartial: (text: string) => void;
  onSpeechStopped: () => void;
  onFinal: (text: string, signal?: AbortSignal) => void | Promise<void>;
  onError: (error: Error) => void;
}

export class StreamingSttError extends Error {
  reported = false;

  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "StreamingSttError";
  }
}

export interface StreamingSttSession {
  readonly providerLabel: string;
  start(): Promise<void>;
  pushAudio(audio: Uint8Array, audioSeq: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  endTurn(): Promise<void>;
  stop(): Promise<void>;
}

export interface StreamingSttAdapter {
  readonly providerLabel: string;
  createSession(options: {
    locale: "ko-KR";
    mimeType: string;
    callbacks: StreamingSttCallbacks;
  }): StreamingSttSession;
}
