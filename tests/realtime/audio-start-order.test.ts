import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("borrower audio capture start order", () => {
  it("does not enable silence finalization before MediaRecorder starts", () => {
    const source = readFileSync(
      "src/realtime/use-audio-interview.ts",
      "utf8",
    );
    const recorderStart = source.indexOf(
      "recorder.start(DEFAULT_AUDIO_CHUNK_MS);",
    );
    const meterStart = source.indexOf("startMeter();", recorderStart);

    expect(recorderStart).toBeGreaterThan(-1);
    expect(meterStart).toBeGreaterThan(recorderStart);
    const analyserReady = source.indexOf(
      "runtime.current.analyser = analyser;",
      source.indexOf("const stream = await navigator.mediaDevices.getUserMedia"),
    );
    const sessionSetup = source.indexOf("const audioSessionId = crypto.randomUUID();", analyserReady);
    expect(source.slice(analyserReady, sessionSetup)).not.toContain("startMeter();");
    expect(
      source.slice(recorderStart, recorderStart + 700),
    ).toContain("startMeter();");
  });
});
