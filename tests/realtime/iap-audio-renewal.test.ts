import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { iapAudioRenewalDelay } from "../../src/realtime/server/iap-audio-renewal";

describe("IAP audio connection lifecycle", () => {
  it("renews before signed identity expires without extending the JWT", () => {
    const now = Date.parse("2026-09-04T01:00:00Z");
    expect(iapAudioRenewalDelay("2026-09-04T01:10:00Z", now)).toBe(480000);
    expect(iapAudioRenewalDelay("2026-09-04T01:01:00Z", now)).toBe(1000);
    expect(() => iapAudioRenewalDelay("not-a-date", now)).toThrow();
  });
  it("wires renewal into resumable close and preserves a user's paused microphone", () => {
    const server = readFileSync("server.ts", "utf8");
    expect(server).toContain('socket.close(4001, "refresh Google authentication")');
    expect(server).toContain("if (state.endTurnRequested || state.finalized)");
    expect(server).toContain("clearTimeout(authenticationRenewalTimer)");
    expect(server).toContain("state.iapAssertion =");
    const client = readFileSync("src/realtime/use-audio-interview.ts", "utf8");
    expect(client).toContain('resources.resumeCaptureAfterReconnect = resources.recorder?.state === "recording"');
    expect(client).toContain('setUxState(current.resumeCaptureAfterReconnect ? "LISTENING" : "PAUSED")');
    expect(client).toContain('type: "audio.start"');
    expect(client).toContain("replay.current.after(current.lastAckedAudioSeq)");
  });
});
