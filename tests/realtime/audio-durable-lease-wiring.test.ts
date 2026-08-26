import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const serverSource = readFileSync("server.ts", "utf8");

describe("custom server durable audio-turn lease wiring", () => {
  it("acquires before provider start and releases only after cancellation drains", () => {
    const newSessionStart = serverSource.indexOf(
      "state.audioLeaseOwnerToken = randomUUID();",
    );
    const acquire = serverSource.indexOf("beginAudioTurnLease(state);", newSessionStart);
    const providerStart = serverSource.indexOf("await state.session.start();", acquire);
    expect(newSessionStart).toBeGreaterThan(-1);
    expect(acquire).toBeGreaterThan(newSessionStart);
    expect(providerStart).toBeGreaterThan(acquire);

    const terminateStart = serverSource.indexOf("async function terminateAudioSession(");
    const terminateEnd = serverSource.indexOf(
      "function evictOneFinalizedReplaySession",
      terminateStart,
    );
    const terminate = serverSource.slice(terminateStart, terminateEnd);
    const drain = terminate.indexOf("await cancelAudioOperationImmediately(");
    const release = terminate.indexOf("finishAudioTurnLease(");
    expect(drain).toBeGreaterThan(-1);
    expect(release).toBeGreaterThan(drain);
    expect(terminate.slice(drain, release)).toContain("finally");
  });

  it("keeps the pending lease through internal persistence and releases after success", () => {
    const persistStart = serverSource.indexOf("async function persistFinalTranscript(");
    const persistEnd = serverSource.indexOf("async function terminateAudioSession(", persistStart);
    const persist = serverSource.slice(persistStart, persistEnd);
    const internalResult = persist.indexOf("let result = await submitFinalTranscript();");
    const finalized = persist.indexOf("state.finalized = true;");
    const release = persist.indexOf("finishAudioTurnLease(state);");
    expect(internalResult).toBeGreaterThan(-1);
    expect(finalized).toBeGreaterThan(internalResult);
    expect(release).toBeGreaterThan(finalized);

    const endTurn = serverSource.slice(
      serverSource.indexOf('if (control.type === "audio.end_turn")'),
      serverSource.indexOf("socket.on(\"close\""),
    );
    expect(endTurn.indexOf("markAudioTurnTranscriptPending(state);")).toBeLessThan(
      endTurn.indexOf("await endTurnWithFailureCleanup("),
    );
  });
});
