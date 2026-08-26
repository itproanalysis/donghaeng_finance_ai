import { describe, expect, it } from "vitest";

import { borrowerMessageCommandPayload } from "@/components/borrower-message-command";

describe("borrower message retry command", () => {
  it("reuses every durable command field and omits UI-only processing state", () => {
    const pending = {
      text: "월 고정 운영비는 900만원입니다.",
      clientMessageId: "borrower-command-1",
      expectedVersion: 7,
      currentQuestionInfoCode: "fixed_operating_costs",
      transcriptMetadata: {
        startMs: 100,
        endMs: 1_200,
        sttConfidence: 0.91,
        sttProvider: "local-stt",
      },
      processingState: "READY" as const,
    };

    expect(borrowerMessageCommandPayload(pending)).toEqual({
      text: pending.text,
      clientMessageId: pending.clientMessageId,
      expectedVersion: pending.expectedVersion,
      currentQuestionInfoCode: pending.currentQuestionInfoCode,
      transcriptMetadata: pending.transcriptMetadata,
    });
    expect(borrowerMessageCommandPayload(pending)).not.toHaveProperty("processingState");
  });
});
