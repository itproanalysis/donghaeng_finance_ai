import { describe, expect, it } from "vitest";

import {
  BoundedAudioReplayBuffer,
  PREFERRED_AUDIO_MIME_TYPES,
  selectSupportedAudioMimeType,
} from "../../src/realtime/media-recorder";

function frame(byte: number): ArrayBuffer {
  return Uint8Array.of(byte).buffer;
}

describe("audio capture negotiation", () => {
  it("브라우저와 서버가 함께 지원하는 MIME 중 우선순위가 가장 높은 형식을 선택한다", () => {
    const supported = new Set(["audio/webm", "audio/mp4"]);

    expect(
      selectSupportedAudioMimeType(
        (mimeType) => supported.has(mimeType),
        ["audio/mp4", "audio/webm"],
      ),
    ).toBe("audio/webm");
    expect(PREFERRED_AUDIO_MIME_TYPES[0]).toBe("audio/webm;codecs=opus");
  });

  it("브라우저와 서버의 공통 MIME이 없으면 추측하지 않고 null을 반환한다", () => {
    expect(
      selectSupportedAudioMimeType(
        (mimeType) => mimeType === "audio/webm;codecs=opus",
        ["audio/mp4"],
      ),
    ).toBeNull();
  });
});

describe("BoundedAudioReplayBuffer", () => {
  it("ACK 이후 chunk만 재전송하고 capacity를 넘긴 오래된 chunk를 버린다", () => {
    const replay = new BoundedAudioReplayBuffer(3);
    replay.push({ audioSeq: 1, frame: frame(1) });
    replay.push({ audioSeq: 2, frame: frame(2) });
    replay.push({ audioSeq: 3, frame: frame(3) });
    replay.push({ audioSeq: 4, frame: frame(4) });

    expect(replay.after(0).map((chunk) => chunk.audioSeq)).toEqual([2, 3, 4]);
    replay.acknowledge(3);
    expect(replay.after(0).map((chunk) => chunk.audioSeq)).toEqual([4]);
    expect(replay.size).toBe(1);

    replay.clear();
    expect(replay.size).toBe(0);
  });

  it("잘못된 capacity와 audio sequence를 fail-closed한다", () => {
    expect(() => new BoundedAudioReplayBuffer(0)).toThrow(
      "REPLAY_BUFFER_CAPACITY_INVALID",
    );

    const replay = new BoundedAudioReplayBuffer(2);
    expect(() => replay.push({ audioSeq: 0, frame: frame(0) })).toThrow(
      "AUDIO_SEQUENCE_INVALID",
    );
  });
});
