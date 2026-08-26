import type { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import {
  createDevV1AcceptanceRequiredInformationItems,
  planDeterministicInterviewTurn,
  selectTurnNextQuestionCandidates,
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
  it.each([
    "monthly_average_sales",
    "fixed_operating_costs",
    "improvement_plan",
    "confirmed_reservations",
  ] as const)("honors the borrower-selected starting item %s", (initialInfoCode) => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `borrower-focus-${initialInfoCode}-${++id}`,
    });
    const created = service.createInterview(
      principal,
      createDevV1AcceptanceRequiredInformationItems().map((item) => ({
        ...item,
        priority: item.required ? item.priority : "P2",
        status: item.infoCode === initialInfoCode ? "ASKING" : "NEEDED",
      })),
    );

    expect(created.nextQuestion?.infoCode).toBe(initialInfoCode);
    expect(created.informationItems.filter((item) => item.status === "ASKING"))
      .toHaveLength(1);
    expect(created.transcript).toHaveLength(1);
    expect(created.transcript[0]).toMatchObject({
      speaker: "ASSISTANT",
      text: created.nextQuestion?.text,
    });
  });

  it("captures strongly anchored optional signals without offering them as default questions", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const selectedText = "매출과 비용 흐름을 확인했어요. 앞으로 확정된 예약이나 주문도 살펴볼게요.";
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `bounded-choice-${++id}`,
      asyncTurnPlanner: {
        plan: async (input) => {
          const deterministic = planDeterministicInterviewTurn(input);
          if (input.currentInfoCode !== "fixed_operating_costs") {
            return {
              plan: deterministic,
              metadata: {
                provider: "deterministic" as const,
                model: "local-dev-v1",
                requestId: null,
                inputTokens: null,
                outputTokens: null,
                stopReason: null,
              },
            };
          }
          const eligible = selectTurnNextQuestionCandidates(
            input,
            deterministic.stateChanges,
            3,
          );
          expect(eligible.map((candidate) => candidate.infoCode)).toEqual([
            "improvement_plan",
            "confirmed_reservations",
            "seasonality_outlook",
          ]);
          const selected = eligible[1];
          if (!selected) throw new Error("expected bounded required candidate");
          return {
            plan: {
              ...deterministic,
              nextQuestion: { ...selected, text: selectedText },
            },
            metadata: {
              provider: "anthropic",
              model: "claude-sonnet-5",
              requestId: "bounded-choice-request",
              inputTokens: 20,
              outputTokens: 10,
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
        status: item.infoCode === "monthly_average_sales" ? "ASKING" : "NEEDED",
      })),
    );

    const salesResult = await service.addMessageCommandAsync(
      created.session.id,
      {
        text: "최근 3개월 월평균 매출은 2,300만원입니다.",
        clientMessageId: "bounded-choice-answer",
        expectedVersion: created.session.version,
        currentQuestionInfoCode: "monthly_average_sales",
      },
      principal,
    );
    expect(salesResult.snapshot.nextQuestion?.infoCode).toBe("fixed_operating_costs");

    const result = await service.addMessageCommandAsync(
      created.session.id,
      {
        text: "월 고정 운영비는 1,000만원이고 배달 수수료 부담도 큽니다.",
        clientMessageId: "bounded-choice-fixed-cost-answer",
        expectedVersion: salesResult.snapshot.session.version,
        currentQuestionInfoCode: "fixed_operating_costs",
      },
      principal,
    );

    expect(result.snapshot.nextQuestion).toMatchObject({
      infoCode: "confirmed_reservations",
      text: selectedText,
    });
    expect(result.snapshot.informationItems.find(
      (item) => item.infoCode === "platform_fee_pressure",
    )?.status).toBe("CONFIRMED");
    expect(result.snapshot.informationItems.find(
      (item) => item.infoCode === "hall_customer_decline",
    )?.status).toBe("NEEDED");
    expect(result.snapshot.informationItems.find(
      (item) => item.infoCode === "improvement_plan",
    )?.status).toBe("NEEDED");
    expect(result.snapshot.transcript.at(-1)).toMatchObject({
      speaker: "ASSISTANT",
      text: selectedText,
    });
  });

  it("keeps the server-selected item but persists Claude's context-aware next-question wording", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const contextualQuestion =
      "말씀해 주신 매출 흐름을 이해했어요. 매달 고정적으로 나가는 운영비는 어느 정도인지 알려주실 수 있을까요?";
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `adaptive-question-${++id}`,
      asyncTurnPlanner: {
        plan: async (input) => {
          const deterministic = planDeterministicInterviewTurn(input);
          expect(deterministic.nextQuestion?.infoCode).toBe("fixed_operating_costs");
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
        status: item.infoCode === "monthly_average_sales" ? "ASKING" : "NEEDED",
      })),
    );

    const result = await service.addMessageCommandAsync(
      created.session.id,
      {
        text: "최근 3개월 월평균 매출은 2,300만원입니다.",
        clientMessageId: "adaptive-question-answer",
        expectedVersion: created.session.version,
        currentQuestionInfoCode: created.nextQuestion?.infoCode ?? null,
      },
      principal,
    );

    expect(result.snapshot.nextQuestion).toMatchObject({
      infoCode: "fixed_operating_costs",
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
        text: "잘 모르겠어요.",
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
        text: "아직도 잘 모르겠습니다.",
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

  it("asks once after an explicit refusal, then records refusal and moves on", async () => {
    const database = createInMemoryDatabase();
    databases.push(database);
    let id = 0;
    const service = new InterviewService(new InterviewRepository(database), {
      idFactory: () => `refused-answer-${++id}`,
    });
    const created = service.createInterview(
      principal,
      createDevV1AcceptanceRequiredInformationItems().map((item) => ({
        ...item,
        priority: item.required ? item.priority : "P2",
        status: item.infoCode === "essential_household_expenses" ? "ASKING" : "NEEDED",
      })),
    );

    const first = await service.addMessageCommandAsync(
      created.session.id,
      {
        text: "그 부분은 말하기 싫어요.",
        clientMessageId: "refused-followup-1",
        expectedVersion: created.session.version,
        currentQuestionInfoCode: "essential_household_expenses",
      },
      principal,
    );
    expect(first.snapshot.informationItems.find(
      (item) => item.infoCode === "essential_household_expenses",
    )).toMatchObject({ status: "NEEDS_FOLLOWUP", valueState: "UNKNOWN" });
    expect(first.snapshot.nextQuestion?.infoCode).toBe("essential_household_expenses");

    const second = await service.addMessageCommandAsync(
      created.session.id,
      {
        text: "답변을 거부합니다.",
        clientMessageId: "refused-followup-2",
        expectedVersion: first.snapshot.session.version,
        currentQuestionInfoCode: "essential_household_expenses",
      },
      principal,
    );
    expect(second.snapshot.informationItems.find(
      (item) => item.infoCode === "essential_household_expenses",
    )).toMatchObject({ status: "REFUSED", valueState: "REFUSED" });
    expect(second.snapshot.nextQuestion?.infoCode).not.toBe("essential_household_expenses");
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
