import type { EvidenceKind, InformationQuality, ValueState } from "./interview";
import {
  type CanonicalInformationValue,
  type CanonicalValueRevision,
  type NumericMeasure,
  type PeriodicMoneyValue,
} from "./information-values";

export const DEV_V1_AMOUNT_CONFLICT_POLICY = {
  version: "dev-v1",
  relativeDifference: 0.25,
  absoluteDifferenceKrw: 1_000_000,
} as const;

export interface CreateRevisionInput {
  id: string;
  infoCode: string;
  valueState: ValueState;
  value: CanonicalInformationValue | null;
  quality: InformationQuality | null;
  parserConfidence: number | null;
  verification: EvidenceKind;
  evidenceIds: string[];
  observedAt: string;
  supersedesRevisionId?: string | null;
}

export interface CanonicalConflict {
  id: string;
  infoCode: string;
  status: "OPEN" | "RESOLVED";
  candidateRevisionIds: [string, string];
  reason: "MATERIAL_VALUE_DIFFERENCE" | "INCOMPARABLE_BASIS";
  policyVersion: "dev-v1";
  resolution: ConflictResolution | null;
}

export type ConflictResolutionType =
  | "KEEP_PREFILL"
  | "ACCEPT_REPORTED"
  | "MERGE_CHANNELS"
  | "CORRECT_TRANSCRIPT";

export interface ConflictResolution {
  type: ConflictResolutionType;
  selectedRevisionId: string;
  resolutionRevisionId: string;
  evidenceIds: string[];
  reason: string;
  resolvedAt: string;
}

export function createCanonicalValueRevision(
  input: CreateRevisionInput,
  existing: readonly CanonicalValueRevision[] = [],
): CanonicalValueRevision {
  if (existing.some((revision) => revision.id === input.id)) {
    throw new Error(`중복 value revision id입니다: ${input.id}`);
  }
  return {
    ...input,
    revision: Math.max(0, ...existing.map((revision) => revision.revision)) + 1,
    evidenceIds: [...new Set(input.evidenceIds)],
    status: "CANDIDATE",
    supersedesRevisionId: input.supersedesRevisionId ?? null,
  };
}

export function selectCanonicalRevision(
  revisions: readonly CanonicalValueRevision[],
  selectedRevisionId: string,
): CanonicalValueRevision[] {
  if (!revisions.some((revision) => revision.id === selectedRevisionId)) {
    throw new Error(`선택할 value revision이 없습니다: ${selectedRevisionId}`);
  }
  return revisions.map((revision) => ({
    ...revision,
    status:
      revision.id === selectedRevisionId
        ? "SELECTED"
        : revision.status === "SELECTED"
          ? "SUPERSEDED"
          : revision.status,
  }));
}

function measureBounds(measure: NumericMeasure): [number, number] {
  return measure.kind === "EXACT"
    ? [measure.value, measure.value]
    : [measure.min, measure.max];
}

function sameMoneyBasis(left: PeriodicMoneyValue, right: PeriodicMoneyValue): boolean {
  const channels = (value: PeriodicMoneyValue) => [...(value.channels ?? [])].sort().join("|");
  return (
    left.currency === right.currency &&
    left.cadence === right.cadence &&
    left.aggregation === right.aggregation &&
    left.basis === right.basis &&
    left.referenceWindow.unit === right.referenceWindow.unit &&
    left.referenceWindow.count === right.referenceWindow.count &&
    left.referenceWindow.relation === right.referenceWindow.relation &&
    (left.grossNetBasis ?? "UNSPECIFIED") === (right.grossNetBasis ?? "UNSPECIFIED") &&
    channels(left) === channels(right)
  );
}

export function detectCanonicalValueConflict(
  id: string,
  left: CanonicalValueRevision,
  right: CanonicalValueRevision,
): CanonicalConflict | null {
  if (!left.value || !right.value || left.infoCode !== right.infoCode) return null;
  if (left.value.kind !== right.value.kind) {
    return {
      id,
      infoCode: left.infoCode,
      status: "OPEN",
      candidateRevisionIds: [left.id, right.id],
      reason: "INCOMPARABLE_BASIS",
      policyVersion: "dev-v1",
      resolution: null,
    };
  }
  if (left.value.kind === "PERCENTAGE" && right.value.kind === "PERCENTAGE") {
    const sameBasis =
      left.value.basis === right.value.basis &&
      left.value.referenceWindow.unit === right.value.referenceWindow.unit &&
      left.value.referenceWindow.count === right.value.referenceWindow.count &&
      left.value.referenceWindow.relation === right.value.referenceWindow.relation;
    if (!sameBasis) {
      return {
        id,
        infoCode: left.infoCode,
        status: "OPEN",
        candidateRevisionIds: [left.id, right.id],
        reason: "INCOMPARABLE_BASIS",
        policyVersion: "dev-v1",
        resolution: null,
      };
    }
    const [leftMin, leftMax] = measureBounds(left.value.percentage);
    const [rightMin, rightMax] = measureBounds(right.value.percentage);
    // An exact follow-up inside the earlier semantic range is a refinement,
    // not a contradictory report. Both revisions remain append-only.
    if (leftMin <= rightMax && rightMin <= leftMax) return null;
    return {
      id,
      infoCode: left.infoCode,
      status: "OPEN",
      candidateRevisionIds: [left.id, right.id],
      reason: "MATERIAL_VALUE_DIFFERENCE",
      policyVersion: "dev-v1",
      resolution: null,
    };
  }
  if (left.value.kind !== "PERIODIC_MONEY" || right.value.kind !== "PERIODIC_MONEY") {
    return JSON.stringify(left.value) === JSON.stringify(right.value)
      ? null
      : {
          id,
          infoCode: left.infoCode,
          status: "OPEN",
          candidateRevisionIds: [left.id, right.id],
          reason: "MATERIAL_VALUE_DIFFERENCE",
          policyVersion: "dev-v1",
          resolution: null,
        };
  }
  if (!sameMoneyBasis(left.value, right.value)) {
    return {
      id,
      infoCode: left.infoCode,
      status: "OPEN",
      candidateRevisionIds: [left.id, right.id],
      reason: "INCOMPARABLE_BASIS",
      policyVersion: "dev-v1",
      resolution: null,
    };
  }
  const [leftMin, leftMax] = measureBounds(left.value.amount);
  const [rightMin, rightMax] = measureBounds(right.value.amount);
  if (leftMin <= rightMax && rightMin <= leftMax) return null;
  const leftCenter = (leftMin + leftMax) / 2;
  const rightCenter = (rightMin + rightMax) / 2;
  const difference = Math.abs(leftCenter - rightCenter);
  const threshold = Math.max(
    DEV_V1_AMOUNT_CONFLICT_POLICY.absoluteDifferenceKrw,
    Math.abs(leftCenter) * DEV_V1_AMOUNT_CONFLICT_POLICY.relativeDifference,
  );
  if (difference < threshold) return null;
  return {
    id,
    infoCode: left.infoCode,
    status: "OPEN",
    candidateRevisionIds: [left.id, right.id],
    reason: "MATERIAL_VALUE_DIFFERENCE",
    policyVersion: "dev-v1",
    resolution: null,
  };
}

export function markConflictRevisions(
  revisions: readonly CanonicalValueRevision[],
  conflict: CanonicalConflict,
): CanonicalValueRevision[] {
  const conflicting = new Set(conflict.candidateRevisionIds);
  return revisions.map((revision) =>
    conflicting.has(revision.id) ? { ...revision, status: "CONFLICTING" } : { ...revision },
  );
}

export function resolveCanonicalConflict(
  conflict: CanonicalConflict,
  resolution: ConflictResolution,
  revisions: readonly CanonicalValueRevision[],
): { conflict: CanonicalConflict; revisions: CanonicalValueRevision[] } {
  if (conflict.status !== "OPEN") throw new Error("이미 해소된 conflict입니다.");
  if (!conflict.candidateRevisionIds.includes(resolution.selectedRevisionId)) {
    throw new Error("선택 revision은 conflict의 후보 중 하나여야 합니다.");
  }
  if (!revisions.some((revision) => revision.id === resolution.resolutionRevisionId)) {
    throw new Error("해소 결과는 overwrite가 아닌 새 revision으로 먼저 생성해야 합니다.");
  }
  return {
    conflict: { ...conflict, status: "RESOLVED", resolution },
    revisions: selectCanonicalRevision(revisions, resolution.resolutionRevisionId),
  };
}
