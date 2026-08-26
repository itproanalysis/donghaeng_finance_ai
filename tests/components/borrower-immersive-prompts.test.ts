import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type {
  GoalView,
  InformationItemView,
  TranscriptView,
} from "@/components/api-adapter";
import {
  buildEvidenceCuriosityCard,
  buildGroundedScenarioPrompt,
  buildImprovementCandidates,
  reconstructQuestionAnswerHistory,
} from "@/components/borrower-immersive-prompts";

const roomSource = readFileSync(
  new URL("../../src/components/borrower-interview-room.tsx", import.meta.url),
  "utf8",
);
const completionSource = readFileSync(
  new URL("../../src/components/borrower-completion-review.tsx", import.meta.url),
  "utf8",
);

function item(
  infoCode: string,
  overrides: Partial<InformationItemView> = {},
): InformationItemView {
  return {
    id: infoCode,
    infoCode,
    label: infoCode,
    category: "CURRENT_STATE",
    categoryLabel: "현재 사업 상태",
    priority: "P1",
    required: true,
    status: "NEEDED",
    statusLabel: "확인 필요",
    valueState: "MISSING",
    valueStateLabel: "없음",
    displayValue: null,
    verificationLabel: null,
    quality: null,
    updatedAt: null,
    bucket: "needed",
    evidenceIds: [],
    dataQualityScore: null,
    dataQualityGrade: null,
    dataQualitySource: null,
    dataQualityAsOf: null,
    dataQualitySummary: null,
    ...overrides,
  };
}

function goal(overrides: Partial<GoalView> = {}): GoalView {
  return {
    title: null,
    baseline: null,
    target: null,
    period: null,
    unit: null,
    measurementSource: null,
    status: "UNRESOLVED",
    numericStatus: null,
    origin: null,
    context: null,
    behaviorEvent: null,
    evidenceIds: [],
    ...overrides,
  };
}

function transcript(
  id: string,
  speaker: "ASSISTANT" | "BORROWER",
  text: string,
  correctedText: string | null = null,
): TranscriptView {
  return {
    id,
    speaker,
    text,
    rawText: text,
    correctedText,
    revision: 0,
    startMs: null,
    endMs: null,
    sttConfidence: null,
    sttProvider: null,
    createdAt: `2026-08-13T10:00:0${id.length}.000Z`,
  };
}

describe("grounded immersive prompts", () => {
  it("offers a hypothetical plan prompt only from confirmed server values", () => {
    expect(buildGroundedScenarioPrompt({
      informationItems: [item("monthly_average_sales", {
        label: "월평균 매출",
        status: "CONFIRMED",
        displayValue: "1,800만원 / 월",
        evidenceIds: ["e-sales"],
      })],
      currentQuestionInfoCode: "improvement_plan",
      questionReason: "PRIORITY",
    })).toEqual(expect.objectContaining({
      label: "생각을 돕는 가정 질문",
      question: expect.stringContaining("월평균 매출을 1,800만원 / 월로 확인"),
      sourceInfoCodes: ["monthly_average_sales"],
      evidenceIds: ["e-sales"],
    }));

    expect(buildGroundedScenarioPrompt({
      informationItems: [item("monthly_average_sales", {
        status: "COLLECTED",
        displayValue: "1,800만원 / 월",
      })],
      currentQuestionInfoCode: "improvement_plan",
      questionReason: "PRIORITY",
    })).toBeNull();
  });

  it("never replaces a conflict or follow-up with a hypothetical prompt", () => {
    const confirmedPlan = item("improvement_plan", {
      status: "CONFIRMED",
      displayValue: "단골 기록을 시작하기",
    });
    for (const questionReason of ["CONFLICT", "FOLLOWUP"]) {
      expect(buildGroundedScenarioPrompt({
        informationItems: [confirmedPlan],
        currentQuestionInfoCode: "execution_readiness",
        questionReason,
      })).toBeNull();
    }
  });

  it("shows the special optional card only when its trigger has persisted evidence", () => {
    const current = item("repeat_customer_share", { required: false, status: "ASKING" });
    const source = item("monthly_average_sales", {
      label: "월평균 매출",
      status: "CONFIRMED",
      displayValue: "1,800만원 / 월",
      evidenceIds: ["e-1"],
    });
    expect(buildEvidenceCuriosityCard({
      informationItems: [current, source],
      currentQuestionInfoCode: "repeat_customer_share",
      displayedQuestion: "최근 한 달 단골 매출 비중은 어느 정도인가요?",
    })).toEqual(expect.objectContaining({
      label: "AI가 한 가지 더 궁금해요",
      optional: true,
      sourceInfoCodes: ["monthly_average_sales"],
      evidenceIds: ["e-1"],
    }));

    expect(buildEvidenceCuriosityCard({
      informationItems: [current, { ...source, evidenceIds: [] }],
      currentQuestionInfoCode: "repeat_customer_share",
      displayedQuestion: "질문",
    })).toBeNull();
  });
});

describe("before-final improvement candidates", () => {
  it("quotes confirmed goal and answers but marks every card unconfirmed", () => {
    const candidates = buildImprovementCandidates({
      goal: goal({
        status: "CONFIRMED",
        title: "3개월 동안 단골 기록 늘리기",
        evidenceIds: ["e-goal"],
      }),
      informationItems: [
        item("improvement_plan", {
          status: "CONFIRMED",
          displayValue: "스탬프 적립을 시작하기",
          evidenceIds: ["e-plan"],
        }),
        item("monthly_average_sales", {
          label: "월평균 매출",
          status: "CONFIRMED",
          displayValue: "1,800만원 / 월",
          evidenceIds: ["e-sales"],
        }),
      ],
    });

    expect(candidates).toHaveLength(3);
    expect(candidates[0]).toMatchObject({
      title: "3개월 동안 단골 기록 늘리기",
      origin: "CONFIRMED_GOAL",
      confirmed: false,
      evidenceIds: ["e-goal"],
    });
    expect(candidates[1]).toMatchObject({
      title: "스탬프 적립을 시작하기",
      origin: "CONFIRMED_ANSWER",
      confirmed: false,
    });
    expect(candidates.every((candidate) => candidate.confirmed === false)).toBe(true);
  });

  it("returns three safe catalog suggestions without inventing borrower facts", () => {
    const candidates = buildImprovementCandidates({ informationItems: [], goal: null });
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.origin === "CATALOG_SUGGESTION")).toBe(true);
    expect(candidates.flatMap((candidate) => candidate.evidenceIds)).toEqual([]);
    expect(candidates.map((candidate) => candidate.sourceInfoCodes)).toEqual([
      ["improvement_plan"],
      ["execution_readiness"],
      ["monthly_average_sales"],
    ]);
  });
});

describe("server transcript Q&A reconstruction", () => {
  it("pairs each borrower response with the preceding assistant question", () => {
    const history = reconstructQuestionAnswerHistory([
      transcript("q1", "ASSISTANT", "첫 질문"),
      transcript("a1", "BORROWER", "원문 답변", "교정 답변"),
      transcript("q2", "ASSISTANT", "둘째 질문"),
      transcript("a2", "BORROWER", "둘째 답변"),
    ]);
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ question: "첫 질문", answer: "교정 답변" });
    expect(history[1]).toMatchObject({ question: "둘째 질문", answer: "둘째 답변" });
  });

  it("separates a Claude reaction from the exact catalog question used by voice playback", () => {
    const canonical = "최근 3개월 기준으로 임차료·인건비·정기구독료처럼 매달 반복되는 운영비는 평균 얼마인가요?";
    const history = reconstructQuestionAnswerHistory([
      transcript("q1", "ASSISTANT", `매출 기준을 잘 확인했어요. ${canonical}`),
      transcript("a1", "BORROWER", "월 500만원입니다."),
    ]);
    expect(history[0]).toMatchObject({
      question: canonical,
      answer: "월 500만원입니다.",
    });
  });

  it("ignores orphan answers and incomplete questions", () => {
    expect(reconstructQuestionAnswerHistory([
      transcript("a0", "BORROWER", "고립 답변"),
      transcript("q1", "ASSISTANT", "아직 답 없는 질문"),
    ])).toEqual([]);
  });
});

describe("borrower immersive UI integration", () => {
  it("renders grounded scenario and evidence curiosity projections without auto-submitting them", () => {
    expect(roomSource).toContain("buildGroundedScenarioPrompt({");
    expect(roomSource).toContain("buildEvidenceCuriosityCard({");
    expect(roomSource).toContain('className="borrower-scenario-prompt"');
    expect(roomSource).toContain('className="borrower-curiosity-card"');
    expect(roomSource).toContain('querySelector<HTMLTextAreaElement>("#borrower-answer")?.focus()');
    expect(roomSource).not.toContain("submitAnswer(scenarioPrompt.question)");
  });

  it("uses server transcript reconstruction for portable Q&A review", () => {
    expect(roomSource).toContain("reconstructQuestionAnswerHistory(transcriptMessages)");
    expect(roomSource).toContain("mergeQuestionAnswerHistory(reconstructedHistory, history)");
    expect(roomSource).toContain("reviewHistory.map(");
  });

  it("requires an explicit candidate-or-skip choice before final confirmation", () => {
    expect(completionSource).toContain("buildImprovementCandidates({");
    expect(completionSource).toContain('const candidateChoiceMade = selectedCandidateId === "SKIP"');
    expect(completionSource).toContain("candidateSelection?.version === live.version");
    expect(completionSource).toContain("confirmationVersion === live.version && candidateChoiceMade");
    expect(completionSource).toContain('selectedCandidateId === "SKIP"');
    expect(completionSource).toContain("확정 목표·평가·신용판단으로 저장되지 않습니다");
  });
});
