import { describe, expect, it } from "vitest";

import {
  AUDIO_PROTOCOL_VERSION,
  decodeAudioFrame,
  encodeAudioFrame,
  parseAudioServerMessage,
} from "../../src/realtime/audio-protocol";
import {
  BoundedAudioReplayBuffer,
  selectSupportedAudioMimeType,
} from "../../src/realtime/media-recorder";

describe("audio binary framing", () => {
  it("accepts recognition before durable turn application", () => {
    expect(parseAudioServerMessage(JSON.stringify({
      protocolVersion: AUDIO_PROTOCOL_VERSION,
      type: "stt.recognized",
      audioSessionId: "audio-session-1",
      text: "최근 매출이 줄었습니다.",
      provider: "local-whisper",
      serverTime: new Date(0).toISOString(),
    }))).toMatchObject({
      type: "stt.recognized",
      text: "최근 매출이 줄었습니다.",
    });
  });

  it("preserves durable processing status on the final voice turn", () => {
    expect(parseAudioServerMessage(JSON.stringify({
      protocolVersion: AUDIO_PROTOCOL_VERSION,
      type: "stt.final",
      audioSessionId: "audio-session-1",
      text: "최근 매출이 줄었습니다.",
      provider: "local-whisper",
      serverTime: new Date(0).toISOString(),
      processingStatus: "RETRYABLE_FAILURE",
      processingCode: "CLAUDE_TIMEOUT",
    }))).toMatchObject({
      type: "stt.final",
      processingStatus: "RETRYABLE_FAILURE",
      processingCode: "CLAUDE_TIMEOUT",
    });
  });

  it.each([
    {
      protocolVersion: AUDIO_PROTOCOL_VERSION,
      type: "stt.final",
      audioSessionId: "audio-session-1",
      text: "답변",
      provider: "local-whisper",
      serverTime: new Date(0).toISOString(),
      processingCode: null,
    },
    {
      protocolVersion: AUDIO_PROTOCOL_VERSION,
      type: "stt.final",
      audioSessionId: "audio-session-1",
      text: "답변",
      provider: "local-whisper",
      serverTime: new Date(0).toISOString(),
      processingStatus: "UNKNOWN_STATUS",
      processingCode: null,
    },
    {
      protocolVersion: AUDIO_PROTOCOL_VERSION,
      type: "future.message",
    },
    {
      protocolVersion: AUDIO_PROTOCOL_VERSION,
      type: "audio.ack",
      audioSessionId: "audio-session-1",
      lastAudioSeq: -1,
    },
  ])("rejects a malformed message instead of trusting its type", (message) => {
    expect(() => parseAudioServerMessage(JSON.stringify(message))).toThrow(
      /AUDIO_SERVER_MESSAGE_/,
    );
  });
  it("round-trips metadata and audio without conflating event sequences", () => {
    const frame = encodeAudioFrame(
      {
        protocolVersion: AUDIO_PROTOCOL_VERSION,
        type: "audio.chunk",
        audioSessionId: "audio-session-1",
        audioSeq: 7,
        clientMonotonicMs: 1234.5,
        mimeType: "audio/webm;codecs=opus",
      },
      new Uint8Array([1, 2, 3]),
    );

    const decoded = decodeAudioFrame(frame);
    expect(decoded.header.audioSeq).toBe(7);
    expect(decoded.header.audioSessionId).toBe("audio-session-1");
    expect([...decoded.audio]).toEqual([1, 2, 3]);
  });

  it("rejects malformed and audio-free frames", () => {
    expect(() => decodeAudioFrame(new Uint8Array([0, 0, 0, 0, 1]))).toThrow(
      "AUDIO_FRAME_INVALID_HEADER_LENGTH",
    );
  });
});

describe("media recorder negotiation and replay", () => {
  it("selects the first MIME type accepted by browser and server", () => {
    expect(
      selectSupportedAudioMimeType(
        (mime) => mime === "audio/webm",
        ["audio/webm", "audio/mp4"],
      ),
    ).toBe("audio/webm");
  });

  it("returns null when no safe common MIME type exists", () => {
    expect(selectSupportedAudioMimeType(() => false)).toBeNull();
  });

  it("keeps only a bounded unacknowledged replay window", () => {
    const buffer = new BoundedAudioReplayBuffer(2);
    buffer.push({ audioSeq: 1, frame: new ArrayBuffer(1) });
    buffer.push({ audioSeq: 2, frame: new ArrayBuffer(1) });
    buffer.push({ audioSeq: 3, frame: new ArrayBuffer(1) });
    expect(buffer.after(0).map((chunk) => chunk.audioSeq)).toEqual([2, 3]);
    buffer.acknowledge(2);
    expect(buffer.after(0).map((chunk) => chunk.audioSeq)).toEqual([3]);
  });
});
