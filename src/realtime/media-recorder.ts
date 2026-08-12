export const PREFERRED_AUDIO_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
] as const;

export const DEFAULT_AUDIO_CHUNK_MS = 400;
export const MAX_WS_BUFFERED_BYTES = 1_000_000;
export const MAX_REPLAY_CHUNKS = 40;

export function selectSupportedAudioMimeType(
  isTypeSupported: (mimeType: string) => boolean,
  serverAccepted: readonly string[] = PREFERRED_AUDIO_MIME_TYPES,
): string | null {
  for (const mimeType of PREFERRED_AUDIO_MIME_TYPES) {
    if (serverAccepted.includes(mimeType) && isTypeSupported(mimeType)) {
      return mimeType;
    }
  }
  return null;
}

export interface ReplayChunk {
  audioSeq: number;
  frame: ArrayBuffer;
}

export class BoundedAudioReplayBuffer {
  private chunks: ReplayChunk[] = [];

  constructor(private readonly capacity = MAX_REPLAY_CHUNKS) {
    if (!Number.isSafeInteger(capacity) || capacity <= 0) {
      throw new Error("REPLAY_BUFFER_CAPACITY_INVALID");
    }
  }

  push(chunk: ReplayChunk): void {
    if (!Number.isSafeInteger(chunk.audioSeq) || chunk.audioSeq <= 0) {
      throw new Error("AUDIO_SEQUENCE_INVALID");
    }
    this.chunks.push(chunk);
    if (this.chunks.length > this.capacity) {
      this.chunks.splice(0, this.chunks.length - this.capacity);
    }
  }

  acknowledge(lastAudioSeq: number): void {
    this.chunks = this.chunks.filter((chunk) => chunk.audioSeq > lastAudioSeq);
  }

  after(lastAudioSeq: number): ReplayChunk[] {
    return this.chunks.filter((chunk) => chunk.audioSeq > lastAudioSeq);
  }

  clear(): void {
    this.chunks = [];
  }

  get size(): number {
    return this.chunks.length;
  }
}

