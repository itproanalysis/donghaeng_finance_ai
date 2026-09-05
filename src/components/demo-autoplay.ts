"use client";

import { useEffect, useRef } from "react";

import { findDemoScenario } from "@/domain/demo-scenario";

/**
 * 시연용 자동 재생. 주소에 `?demo=<시나리오 id>`가 있을 때만 대본의 답변을
 * 순서대로 넣는다.
 *
 * 답변은 화면에서 만들지 않고 `src/domain/demo-scenario.ts`의 대본을 그대로
 * 읽는다. 질문 순서는 서버가 정하므로 여기서는 지금 질문에 해당하는 답만 찾아
 * 보낸다. 쿼리가 없으면 아무 일도 하지 않고 사람이 직접 진행한다.
 */

export const DEMO_QUERY_PARAMETER = "demo";
export const DEMO_ANSWER_SET_QUERY_PARAMETER = "demoSet";

export interface DemoAutoplayOptions {
  /** 지금 서버가 물어보는 항목. 없으면 인터뷰가 끝난 것이다. */
  currentQuestionInfoCode: string | null;
  /** 답을 보낼 수 있는 상태인지. 전송 중이거나 대기 중이면 false다. */
  ready: boolean;
  submitAnswer: (text: string) => void | Promise<void>;
  /** 답변 사이 간격. 심사위원이 화면을 따라올 수 있게 둔다. */
  delayMs?: number;
}

/** 주소에서 시나리오 id와 답변 묶음을 읽는다. 서버 렌더 중에는 null이다. */
export function readDemoSelection(search: string): {
  scenarioId: string;
  answerSetId: "primary" | "control";
} | null {
  const parameters = new URLSearchParams(search);
  const scenarioId = parameters.get(DEMO_QUERY_PARAMETER);
  if (!scenarioId) return null;
  return {
    scenarioId,
    answerSetId: parameters.get(DEMO_ANSWER_SET_QUERY_PARAMETER) === "control" ? "control" : "primary",
  };
}

export function useDemoAutoplay({
  currentQuestionInfoCode,
  ready,
  submitAnswer,
  delayMs = 1200,
}: DemoAutoplayOptions): void {
  // 같은 질문에 두 번 답하지 않게 이미 보낸 항목을 기억한다.
  const answeredRef = useRef(new Set<string>());
  const submitRef = useRef(submitAnswer);

  useEffect(() => {
    submitRef.current = submitAnswer;
  }, [submitAnswer]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!ready || !currentQuestionInfoCode) return;

    const selection = readDemoSelection(window.location.search);
    if (!selection) return;

    const scenario = findDemoScenario(selection.scenarioId);
    if (!scenario) return;

    const answerSet = selection.answerSetId === "control" ? scenario.control : scenario.primary;
    const answer = answerSet.answers[currentQuestionInfoCode as keyof typeof answerSet.answers];
    if (!answer) return;

    const alreadyAnswered = `${answerSet.id}:${currentQuestionInfoCode}`;
    if (answeredRef.current.has(alreadyAnswered)) return;
    answeredRef.current.add(alreadyAnswered);

    const timer = window.setTimeout(() => {
      void submitRef.current(answer);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [currentQuestionInfoCode, delayMs, ready]);
}
