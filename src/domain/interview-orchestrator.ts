import {
  DEV_V1_ALL_INFO_CODES,
  DEV_V1_ALL_INFORMATION_CATALOG,
  type DevV1AllInfoCode,
} from "./information-catalog";
import {
  containsStrongAnchor,
  parseCanonicalInformation,
} from "./information-parsers";
import type {
  InformationItem,
  InformationStatus,
  NextQuestion,
} from "./interview";
import type { CanonicalExtractionCandidate } from "./information-values";
import type { OrchestratorTurnInput } from "./orchestrator-contract";
import {
  questionSelectionContextAfterAnswer,
  selectEligibleNextQuestions,
} from "./question-selector";
import { assertInformationTransition } from "./state-machine";

export interface ProposedInformationTransition {
  infoCode: string;
  from: InformationStatus;
  to: InformationStatus;
  reason: string;
  incidentalExtraction: boolean;
}

export interface DeterministicTurnPlan {
  text: string;
  currentInfoCode: string | null;
  extractedItems: CanonicalExtractionCandidate[];
  stateChanges: ProposedInformationTransition[];
  nextQuestion: NextQuestion | null;
  requiresPersistence: boolean;
}

function isDevV1InfoCode(value: string | null): value is DevV1AllInfoCode {
  return value !== null && (DEV_V1_ALL_INFO_CODES as readonly string[]).includes(value);
}

function candidateTransitions(
  item: InformationItem,
  candidate: CanonicalExtractionCandidate,
  isCurrent: boolean,
): ProposedInformationTransition[] {
  const transitions: ProposedInformationTransition[] = [];
  let status = item.status;
  const incidentalExtraction = !isCurrent;

  if (["CONFIRMED", "UNAVAILABLE", "REFUSED", "NOT_APPLICABLE"].includes(status)) {
    return transitions;
  }

  if (status === "NEEDS_FOLLOWUP" || status === "CONFLICT") {
    assertInformationTransition(status, "ASKING");
    transitions.push({
      infoCode: item.infoCode,
      from: status,
      to: "ASKING",
      reason: "후속·충돌 질문에 대한 응답을 처리하기 위해 ASKING으로 재진입",
      incidentalExtraction: false,
    });
    status = "ASKING";
  }

  if (candidate.valueState === "PRESENT") {
    if (status === "NEEDED") {
      assertInformationTransition(status, "COLLECTED", { incidentalExtraction: true });
      transitions.push({
        infoCode: item.infoCode,
        from: status,
        to: "COLLECTED",
        reason: "현재 질문 밖에서 명시적으로 답한 정보를 incidental extraction으로 수집",
        incidentalExtraction: true,
      });
      status = "COLLECTED";
    } else if (status === "ASKING") {
      assertInformationTransition(status, "COLLECTED");
      transitions.push({
        infoCode: item.infoCode,
        from: status,
        to: "COLLECTED",
        reason: "canonical candidate와 transcript 근거 수집",
        incidentalExtraction,
      });
      status = "COLLECTED";
    }
    if (candidate.proposedStatus !== "COLLECTED") {
      assertInformationTransition(status, candidate.proposedStatus);
      transitions.push({
        infoCode: item.infoCode,
        from: status,
        to: candidate.proposedStatus,
        reason: candidate.explanation,
        incidentalExtraction,
      });
    }
    return transitions;
  }

  if (status === "NEEDED") {
    assertInformationTransition(status, candidate.proposedStatus, { incidentalExtraction: true });
  } else {
    assertInformationTransition(status, candidate.proposedStatus);
  }
  transitions.push({
    infoCode: item.infoCode,
    from: status,
    to: candidate.proposedStatus,
    reason: candidate.explanation,
    incidentalExtraction,
  });
  return transitions;
}

function applyProposedStatuses(
  items: InformationItem[],
  transitions: ProposedInformationTransition[],
): InformationItem[] {
  const finalByCode = new Map<string, InformationStatus>();
  for (const transition of transitions) finalByCode.set(transition.infoCode, transition.to);
  return items.map((item) => ({ ...item, status: finalByCode.get(item.infoCode) ?? item.status }));
}

/**
 * Projects only server-validated status transitions, then produces the bounded
 * next-question allowlist used by deterministic fallback and Claude alike.
 */
export function selectTurnNextQuestionCandidates(
  input: Pick<OrchestratorTurnInput, "currentInfoCode" | "informationItems">,
  transitions: ProposedInformationTransition[],
  limit = 3,
): NextQuestion[] {
  const projected = applyProposedStatuses(input.informationItems, transitions);
  return selectEligibleNextQuestions(
    projected,
    null,
    questionSelectionContextAfterAnswer(projected, input.currentInfoCode),
    limit,
  );
}

function terminalAfterFollowupLimit(
  candidate: CanonicalExtractionCandidate,
): CanonicalExtractionCandidate {
  return {
    ...candidate,
    valueState: "UNKNOWN",
    value: null,
    quality: null,
    verification: "UNKNOWN",
    missingFields: [],
    proposedStatus: "UNAVAILABLE",
    terminalDisposition: "UNAVAILABLE",
    explanation: "한 차례 추가 확인 뒤에도 답변을 확정하기 어려워 알 수 없음으로 기록하고 다음 질문으로 넘어갑니다.",
  };
}

/**
 * The active question gets one low-pressure clarification after an explicit
 * unknown or refusal. NEEDS_FOLLOWUP is persisted as the durable retry count;
 * a second boundary answer is terminal and the interview moves on.
 */
function applySingleClarificationPolicy(
  candidate: CanonicalExtractionCandidate,
  isCurrent: boolean,
  followupExhausted: boolean,
): CanonicalExtractionCandidate {
  if (!isCurrent) return candidate;
  if (followupExhausted) {
    return candidate.proposedStatus === "NEEDS_FOLLOWUP"
      ? terminalAfterFollowupLimit(candidate)
      : candidate;
  }
  if (
    candidate.terminalDisposition !== "UNAVAILABLE" &&
    candidate.terminalDisposition !== "REFUSED"
  ) {
    return candidate;
  }
  return {
    ...candidate,
    valueState: "UNKNOWN",
    value: null,
    quality: null,
    verification: "UNKNOWN",
    proposedStatus: "NEEDS_FOLLOWUP",
    terminalDisposition: null,
    explanation:
      "첫 확인 불가·답변 곤란 응답이므로 부담 없이 한 번만 추가 확인합니다.",
  };
}

export function planDeterministicInterviewTurn(input: OrchestratorTurnInput): DeterministicTurnPlan {
  const text = input.text.trim();
  if (!text) throw new TypeError("확정 transcript는 빈 문자열일 수 없습니다.");
  const currentInfoCode = isDevV1InfoCode(input.currentInfoCode)
    ? input.currentInfoCode
    : null;
  const followupExhausted = new Set(input.followupExhaustedInfoCodes ?? []);
  const currentItem = input.informationItems.find(
    (item) => item.infoCode === currentInfoCode,
  );
  if (currentItem?.status === "NEEDS_FOLLOWUP") {
    followupExhausted.add(currentItem.infoCode);
  }
  const extractedItems = DEV_V1_ALL_INFORMATION_CATALOG.flatMap((definition) => {
    const isCurrent = definition.infoCode === currentInfoCode;
    if (!isCurrent && !containsStrongAnchor(definition.infoCode, text)) return [];
    const candidate = parseCanonicalInformation(definition.infoCode, text, {
      currentInfoCode,
    });
    if (!candidate) return [];
    return [applySingleClarificationPolicy(
      candidate,
      isCurrent,
      followupExhausted.has(definition.infoCode),
    )];
  });

  if (currentInfoCode && !extractedItems.some((candidate) => candidate.infoCode === currentInfoCode)) {
    const fallback = parseCanonicalInformation(currentInfoCode, text, { currentInfoCode });
    if (fallback) {
      extractedItems.unshift(applySingleClarificationPolicy(
        fallback,
        true,
        followupExhausted.has(currentInfoCode),
      ));
    }
  }

  const stateChanges = extractedItems.flatMap((candidate) => {
    const item = input.informationItems.find((entry) => entry.infoCode === candidate.infoCode);
    return item
      ? candidateTransitions(item, candidate, candidate.infoCode === currentInfoCode)
      : [];
  });
  const nextQuestion = selectTurnNextQuestionCandidates(
    input,
    stateChanges,
    1,
  )[0] ?? null;
  return {
    text,
    currentInfoCode: input.currentInfoCode,
    extractedItems,
    stateChanges,
    nextQuestion,
    requiresPersistence: true,
  };
}
