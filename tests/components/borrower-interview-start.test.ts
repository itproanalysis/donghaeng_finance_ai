import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../../src/components/borrower-interview-start.tsx", import.meta.url),
  "utf8",
);

describe("borrower voice interview start", () => {
  it("unlocks audio in the voice selection gesture and requests first-question autoplay", () => {
    expect(source).toContain('if (method === "voice") unlockQuestionVoicePlayback();');
    expect(source).toContain('method === "voice" ? "&autoplay=1" : ""');
  });
});
