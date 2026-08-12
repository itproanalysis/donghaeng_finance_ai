import type { StreamingSttAdapter, StreamingSttCallbacks, StreamingSttSession } from "./stt-adapter";
import { StreamingSttError } from "./stt-adapter";

/**
 * Deliberate development fallback. It keeps text interview flows available but
 * never invents a transcript from microphone bytes when a real STT runtime is
 * not configured.
 */
export class UnavailableStreamingSttAdapter implements StreamingSttAdapter {
  readonly providerLabel = "로컬 STT 준비 필요 · 임의 전사 사용 안 함";

  createSession(options: {
    locale: "ko-KR";
    mimeType: string;
    callbacks: StreamingSttCallbacks;
  }): StreamingSttSession {
    void options;
    throw new StreamingSttError(
      "STT_LOCAL_RUNTIME_NOT_READY",
      "실제 음성 인식을 위해 로컬 Whisper STT를 시작하세요. 준비 전에는 채팅으로 답변할 수 있습니다.",
      false,
    );
  }
}
