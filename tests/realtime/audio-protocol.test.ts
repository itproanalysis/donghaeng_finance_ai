import { describe, expect, it } from "vitest";

import {
  AUDIO_PROTOCOL_VERSION,
  decodeAudioFrame,
  encodeAudioFrame,
} from "../../src/realtime/audio-protocol";
import {
  BoundedAudioReplayBuffer,
  selectSupportedAudioMimeType,
} from "../../src/realtime/media-recorder";

describe("audio binary framing", () => {
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

