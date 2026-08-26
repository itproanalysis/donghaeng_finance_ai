import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  diffInformationItemSnapshots,
  type InformationItemView,
} from "../../src/components/api-adapter";
import {
  describeLiveEventType,
  describeMessageProcessingDetail,
  describeMessageProcessingProvider,
} from "../../src/components/live-realtime-status";

const workspaceSource = readFileSync(
  new URL("../../src/components/interview-workspace.tsx", import.meta.url),
  "utf8",
);
const globalStyles = readFileSync(
  new URL("../../src/app/globals.css", import.meta.url),
  "utf8",
);

function item(
  status: InformationItemView["status"],
  displayValue: string | null,
  evidenceIds: string[],
): InformationItemView {
  const bucket: InformationItemView["bucket"] =
    status === "CONFIRMED"
      ? "completed"
      : status === "NEEDS_FOLLOWUP" || status === "COLLECTED"
        ? "followUp"
        : status === "CONFLICT"
          ? "conflict"
          : ["UNAVAILABLE", "REFUSED", "NOT_APPLICABLE"].includes(status)
            ? "terminal"
            : "needed";
  return {
    id: "repeat_customer_share",
    infoCode: "repeat_customer_share",
    label: "반복고객 비중",
    category: "CURRENT_STATE",
    categoryLabel: "현재 상황",
    priority: "P0",
    required: false,
    status,
    statusLabel: status === "CONFIRMED" ? "확인 완료" : "추가 확인",
    valueState: displayValue ? "PRESENT" : "UNKNOWN",
    valueStateLabel: displayValue ? "값 있음" : "확인 불가",
    displayValue,
    verificationLabel: null,
    quality: null,
    updatedAt: null,
    bucket,
    evidenceIds,
    dataQualityScore: null,
    dataQualityGrade: null,
    dataQualitySource: null,
    dataQualityAsOf: null,
    dataQualitySummary: null,
  };
}

describe("presentation realtime status", () => {
  it("shows only authoritative information changes between accepted snapshots", () => {
    const unchanged = item("NEEDS_FOLLOWUP", "45~55%", ["evidence-1"]);
    expect(diffInformationItemSnapshots([unchanged], [{ ...unchanged }])).toEqual([]);

    const changes = diffInformationItemSnapshots(
      [unchanged],
      [item("CONFIRMED", "45%", ["evidence-1", "evidence-2"])],
    );

    expect(changes).toEqual([
      expect.objectContaining({
        infoCode: "repeat_customer_share",
        previousStatus: "NEEDS_FOLLOWUP",
        currentStatus: "CONFIRMED",
        previousBucket: "followUp",
        currentBucket: "completed",
        previousDisplayValue: "45~55%",
        currentDisplayValue: "45%",
        evidenceCount: 2,
      }),
    ]);
  });

  it("maps durable server events to presenter-facing stages", () => {
    expect(describeLiveEventType("transcript.finalized")).toBe("전사 확정");
    expect(describeLiveEventType("coverage.changed")).toBe("진행률 갱신");
    expect(describeLiveEventType("question.generated")).toBe("다음 질문 준비");
    expect(describeLiveEventType(null)).toBe("첫 답변 대기");
  });

  it("shows only proven Claude metadata and a presenter-facing processing result", () => {
    const processing = {
      status: "APPLIED" as const,
      provider: "anthropic",
      model: "claude-haiku-4-5-20251001",
      inputTokens: 1_204,
      outputTokens: 287,
      stopReason: "tool_use",
    };

    expect(describeMessageProcessingProvider(processing)).toBe(
      "Claude · Haiku 4.5 · 실시간",
    );
    expect(describeMessageProcessingDetail(processing)).toBe(
      "처리 완료 · 입력 1,204 / 출력 287 토큰 · 종료 tool_use",
    );
    expect(describeMessageProcessingProvider(null)).toBe("AI 처리 대기");
    expect(describeMessageProcessingDetail({
      ...processing,
      status: "NON_RETRYABLE_FAILURE",
      inputTokens: null,
      outputTokens: null,
      stopReason: null,
    })).toBe("분석 거절 · 재처리 차단");
    expect(describeMessageProcessingProvider({
      ...processing,
      model: "claude-sonnet-5",
    })).toBe("Claude · Sonnet 5 · 고품질");
  });

  it("keeps the retryable Claude command explicit and reuses its command id", () => {
    expect(workspaceSource).toContain("setPendingClaudeRetry(command)");
    expect(workspaceSource).toContain("clientMessageId: command.clientMessageId");
    expect(workspaceSource).toContain("Claude 분석 다시 시도");
    expect(workspaceSource).toContain(
      "void sendMessage(pendingClaudeRetry.text, pendingClaudeRetry)",
    );
    expect(workspaceSource).toContain("nextSnapshot.pendingCommand");
    expect(workspaceSource).toContain("durablePendingNoticeRef.current = true");
    expect(workspaceSource).toContain("durablePendingNoticeRef.current = false");
    expect(workspaceSource).toContain('processingState === "PROCESSING"');
  });

  it("uses the live reducer cursor during a pending batch and collapses before the 3-column minimum overflows", () => {
    expect(workspaceSource).toContain(
      "Math.max(snapshot.lastEventSeq, liveState.lastEventSeq)",
    );
    expect(globalStyles).toContain("@media (max-width: 1023px)");
  });
});
