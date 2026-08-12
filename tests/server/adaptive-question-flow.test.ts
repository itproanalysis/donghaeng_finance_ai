import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  createDevV1AcceptanceRequiredInformationItems,
  planDeterministicInterviewTurn,
} from "../../src/domain";
import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "../../src/server/auth";
import { createInMemoryDatabase } from "../../src/server/database";
import { InterviewRepository } from "../../src/server/interview-repository";
import { InterviewService } from "../../src/server/interview-service";

const databases: DatabaseSync[] = [];
const principal: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "대화 흐름 테스트 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe("borrower conversation flow", () => {
  it("keeps the server-selected item but persists Claude's context-aware next-question wording", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const contextualQuestion =
      "말씀해 주신 수수료 부담과 홀 손님 감소를 이해했어요. 최근 한 달 단골 매출 비중은 어느 정도인지 알려주실 수 있을까요?";
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `adaptive-question-${++id}`,
      asyncTurnPlanner: {
        plan: async (input) => {
          const deterministic = planDeterministicInterviewTurn(input);
          expect(deterministic.nextQuestion?.infoCode).toBe("repeat_customer_share");
          return {
            plan: {
              ...deterministic,
              nextQuestion: deterministic.nextQuestion && {
                ...deterministic.nextQuestion,
                text: contextualQuestion,
              },
            },
            metadata: {
              provider: "anthropic",
              model: "claude-sonnet-5",
              requestId: "adaptive-question-request",
              inputTokens: 12,
              outputTokens: 34,
              stopReason: "tool_use",
            },
          };
        },
      },
    });
    const created = service.createInterview(
      principal,
      createDevV1AcceptanceRequiredInformationItems().map((item) => ({
        ...item,
        priority: item.required ? item.priority : "P0",
        status: item.infoCode === "platform_fee_pressure" ? "ASKING" : "NEEDED",
      })),
    );

    const result = await service.addMessageCommandAsync(
      created.session.id,
      {
        text: "배달 수수료가 부담되고 홀 손님도 줄었습니다. 단골 매출은 절반 정도예요.",
        clientMessageId: "adaptive-question-answer",
        expectedVersion: created.session.version,
        currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
      },
      principal,
    );

    expect(result.snapshot.nextQuestion).toMatchObject({
      infoCode: "repeat_customer_share",
      text: contextualQuestion,
    });
    expect(result.snapshot.transcript.at(-1)).toMatchObject({
      speaker: "ASSISTANT",
      text: contextualQuestion,
    });
  });

  it("stops asking an item after a follow-up answer explicitly says it is unknown", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `unknown-answer-${++id}`,
    });
    const created = service.createInterview(
      principal,
      createDevV1AcceptanceRequiredInformationItems().map((item) => ({
        ...item,
        priority: item.required ? item.priority : "P2",
        status: item.infoCode === "confirmed_reservations" ? "ASKING" : "NEEDED",
      })),
    );

    const first = await service.addMessageCommandAsync(
      created.session.id,
      {
        text: "확정 예약이 있는지는 확인이 필요합니다.",
        clientMessageId: "unknown-followup-1",
        expectedVersion: created.session.version,
        currentQuestionInfoCode: "confirmed_reservations",
      },
      principal,
    );
    expect(first.snapshot.informationItems.find((item) => item.infoCode === "confirmed_reservations")?.status)
      .toBe("NEEDS_FOLLOWUP");
    expect(first.snapshot.nextQuestion?.infoCode).toBe("confirmed_reservations");

    const second = await service.addMessageCommandAsync(
      created.session.id,
      {
        text: "모른다니까요.",
        clientMessageId: "unknown-followup-2",
        expectedVersion: first.snapshot.session.version,
        currentQuestionInfoCode: "confirmed_reservations",
      },
      principal,
    );
    expect(second.snapshot.informationItems.find((item) => item.infoCode === "confirmed_reservations"))
      .toMatchObject({ status: "UNAVAILABLE", valueState: "UNKNOWN" });
    expect(second.snapshot.nextQuestion?.infoCode).not.toBe("confirmed_reservations");
  });

  it("allows only one clarification for a vague or unwilling answer before moving on", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `one-followup-${++id}`,
    });
    const created = service.createInterview(
      principal,
      createDevV1AcceptanceRequiredInformationItems().map((item) => ({
        ...item,
        priority: item.required ? item.priority : "P2",
        status: item.infoCode === "improvement_plan" ? "ASKING" : "NEEDED",
      })),
    );

    const first = await service.addMessageCommandAsync(
      created.session.id,
      {
        text: "없어요.",
        clientMessageId: "one-followup-first",
        expectedVersion: created.session.version,
        currentQuestionInfoCode: "improvement_plan",
      },
      principal,
    );
    expect(first.snapshot.informationItems.find((item) => item.infoCode === "improvement_plan")?.status)
      .toBe("NEEDS_FOLLOWUP");
    expect(first.snapshot.nextQuestion?.infoCode).toBe("improvement_plan");

    const second = await service.addMessageCommandAsync(
      created.session.id,
      {
        text: "없다고요.",
        clientMessageId: "one-followup-second",
        expectedVersion: first.snapshot.session.version,
        currentQuestionInfoCode: "improvement_plan",
      },
      principal,
    );
    expect(second.snapshot.informationItems.find((item) => item.infoCode === "improvement_plan"))
      .toMatchObject({ status: "UNAVAILABLE", valueState: "UNKNOWN" });
    expect(second.snapshot.nextQuestion?.infoCode).not.toBe("improvement_plan");
  });
});
