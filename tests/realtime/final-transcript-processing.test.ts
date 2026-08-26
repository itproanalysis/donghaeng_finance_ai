import { describe, expect, it } from "vitest";

import { readPersistedTranscriptProcessing } from "@/realtime/server/final-transcript-processing";

describe("final transcript processing boundary", () => {
  it.each([
    ["APPLIED", null],
    ["RETRYABLE_FAILURE", "TURN_PROCESSING_FAILED"],
    ["NON_RETRYABLE_FAILURE", "TURN_PROCESSING_REJECTED"],
  ] as const)("accepts the explicit %s result", (status, code) => {
    expect(readPersistedTranscriptProcessing({
      processing: { status, code },
    })).toEqual({
      processingStatus: status,
      processingCode: code,
    });
  });

  it.each([
    {},
    { processing: null },
    { processing: { status: "APPLIED" } },
    { processing: { status: "FUTURE_STATUS", code: null } },
    { processing: { status: "APPLIED", code: 1 } },
  ])("fails closed for a missing or malformed processing result", (value) => {
    expect(() => readPersistedTranscriptProcessing(value)).toThrowError(
      expect.objectContaining({
        code: "TURN_PROCESSING_STATUS_INVALID",
        retryable: true,
      }),
    );
  });
});
