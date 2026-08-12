import { describe, expect, it } from "vitest";

import { extractMessageProcessingTelemetry } from "../../src/components/api-adapter";

describe("message processing telemetry adapter", () => {
  it("allow-lists actual Claude status, model, token counts, and stop reason", () => {
    const telemetry = extractMessageProcessingTelemetry({
      processing: {
        status: "APPLIED",
        code: null,
        metadata: {
          provider: "anthropic",
          model: "claude-sonnet-5",
          requestId: "req_must-never-reach-the-ui",
          inputTokens: 1_204,
          outputTokens: 287,
          stopReason: "tool_use",
          prompt: "private raw prompt",
          rawResponse: "private raw provider response",
          apiKey: "private credential",
        },
      },
    });

    expect(telemetry).toEqual({
      status: "APPLIED",
      provider: "anthropic",
      model: "claude-sonnet-5",
      inputTokens: 1_204,
      outputTokens: 287,
      stopReason: "tool_use",
    });
    const serialized = JSON.stringify(telemetry);
    expect(serialized).not.toContain("requestId");
    expect(serialized).not.toContain("private");
    expect(serialized).not.toContain("apiKey");
  });

  it("reads the same allow-list from transcript.finalized event data", () => {
    expect(extractMessageProcessingTelemetry({
      segment: { id: "segment-1", text: "차주 답변" },
      processing: {
        status: "RETRYABLE_FAILURE",
        code: "TURN_PROCESSING_FAILED",
        metadata: {
          provider: "anthropic",
          model: "claude-sonnet-5",
          requestId: "req_hidden",
          inputTokens: null,
          outputTokens: null,
          stopReason: null,
        },
      },
    })).toEqual({
      status: "RETRYABLE_FAILURE",
      provider: "anthropic",
      model: "claude-sonnet-5",
      inputTokens: null,
      outputTokens: null,
      stopReason: null,
    });
  });

  it("exposes only the terminal status for a non-retryable rejection", () => {
    expect(extractMessageProcessingTelemetry({
      processing: {
        status: "NON_RETRYABLE_FAILURE",
        code: "TURN_PROCESSING_REJECTED",
        rawError: "credential and response must stay private",
      },
    })).toEqual({
      status: "NON_RETRYABLE_FAILURE",
      provider: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      stopReason: null,
    });
  });

  it("rejects unknown statuses and drops malformed display fields", () => {
    expect(extractMessageProcessingTelemetry({
      processing: { status: "UNKNOWN", metadata: { provider: "anthropic" } },
    })).toBeNull();

    expect(extractMessageProcessingTelemetry({
      processing: {
        status: "APPLIED",
        metadata: {
          provider: `anthropic${"x".repeat(40)}`,
          model: "claude\nforged-label",
          inputTokens: -1,
          outputTokens: 1.5,
          stopReason: "x".repeat(81),
        },
      },
    })).toEqual({
      status: "APPLIED",
      provider: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      stopReason: null,
    });
  });
});
