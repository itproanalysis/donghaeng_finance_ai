import type { InformationStatus } from "./interview";

export interface TransitionContext {
  correction?: boolean;
  incidentalExtraction?: boolean;
}

export class InvalidInformationTransitionError extends Error {
  readonly code = "INVALID_INFORMATION_TRANSITION";

  constructor(
    readonly from: InformationStatus,
    readonly to: InformationStatus,
  ) {
    super(`정보 상태를 ${from}에서 ${to}(으)로 전환할 수 없습니다.`);
    this.name = "InvalidInformationTransitionError";
  }
}

const ALLOWED_TRANSITIONS: Record<InformationStatus, ReadonlySet<InformationStatus>> = {
  NEEDED: new Set(["ASKING"]),
  ASKING: new Set([
    "COLLECTED",
    "NEEDS_FOLLOWUP",
    "CONFLICT",
    "UNAVAILABLE",
    "REFUSED",
    "NOT_APPLICABLE",
  ]),
  COLLECTED: new Set(["CONFIRMED", "NEEDS_FOLLOWUP", "CONFLICT"]),
  CONFIRMED: new Set(),
  NEEDS_FOLLOWUP: new Set(["ASKING", "UNAVAILABLE", "REFUSED"]),
  CONFLICT: new Set(["ASKING"]),
  UNAVAILABLE: new Set(),
  REFUSED: new Set(),
  NOT_APPLICABLE: new Set(),
};

const CORRECTABLE_STATUSES = new Set<InformationStatus>([
  "CONFIRMED",
  "UNAVAILABLE",
  "REFUSED",
  "NOT_APPLICABLE",
]);

export function isInformationTransitionAllowed(
  from: InformationStatus,
  to: InformationStatus,
  context: TransitionContext = {},
): boolean {
  if (from === to) return false;
  if (context.correction && to === "ASKING" && CORRECTABLE_STATUSES.has(from)) {
    return true;
  }
  if (
    context.incidentalExtraction &&
    from === "NEEDED" &&
    [
      "COLLECTED",
      "NEEDS_FOLLOWUP",
      "UNAVAILABLE",
      "REFUSED",
      "NOT_APPLICABLE",
    ].includes(to)
  ) {
    return true;
  }
  return ALLOWED_TRANSITIONS[from].has(to);
}

export function assertInformationTransition(
  from: InformationStatus,
  to: InformationStatus,
  context: TransitionContext = {},
): void {
  if (!isInformationTransitionAllowed(from, to, context)) {
    throw new InvalidInformationTransitionError(from, to);
  }
}

export function isResolvedInformationStatus(status: InformationStatus): boolean {
  return ["CONFIRMED", "UNAVAILABLE", "REFUSED", "NOT_APPLICABLE"].includes(status);
}

export function canBeAsked(status: InformationStatus): boolean {
  return ["NEEDED", "NEEDS_FOLLOWUP", "CONFLICT"].includes(status);
}
