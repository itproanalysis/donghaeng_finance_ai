import { createHash, randomUUID } from "node:crypto";

import {
  assessInterviewCompletion,
  assertOrchestratorTurnPlan,
  BORROWER_SELECTED_IMPROVEMENT_CANDIDATE,
  buildAllowlistedImprovementCandidates,
  buildEvidenceLinkedSummary,
  buildInterviewFeatureV2,
  buildInterviewDataQualityEvaluationV1,
  buildDeterministicEvaluation,
  calculateLiveFeatures,
  calculateCoverage,
  createCanonicalValueRevision,
  createValidatedOrchestratorProvider,
  createDevV1RequiredInformationItems,
  detectCanonicalValueConflict,
  extractGoalSnapshot,
  isFeatureV2Enabled,
  findSohoIndustryProfile,
  hasMaterialAmountConflict,
  improvementPlanCandidateDisplayValue,
  isAllowlistedImprovementChoice,
  markConflictRevisions,
  parseMonthlyAverageSales,
  planDeterministicInterviewTurn,
  questionSelectionContextAfterAnswer,
  resolveCanonicalConflict,
  selectCanonicalRevision,
  selectEligibleNextQuestions,
  selectNextQuestion,
  validateImmutableFinalSnapshotV1,
  validateRequiredInformationCatalog,
  type CompletionResult,
  type CompletionAssessment,
  type BorrowerFinalConfirmation,
  type BorrowerImprovementChoice,
  type BorrowerImprovementSelection,
  type Coverage,
  type CanonicalInformationRecord,
  type CanonicalInformationValue,
  type CanonicalValueRevision,
  type EvidenceLinkedSummary,
  type EvidenceRef,
  type FinalInterviewSnapshot,
  type FeatureV2Set,
  type InformationItem,
  type RequiredInformationItem,
  type GoalSnapshot,
  type ImmutableFinalInterviewSnapshotV1,
  type InterviewDataQualityEvaluationV1,
  type InterviewEvaluation,
  type LiveFeatureSet,
  type LiveInterviewSnapshot,
  type MessageProcessingResult,
  type MoneyValue,
  type NextQuestion,
  type SohoIndustryCode,
  type TranscriptSegment,
  type TurnPlannerProcessingMetadata,
  type DeterministicTurnPlan,
  type OrchestratorTurnInput,
} from "@/domain";

import { ApplicationError } from "./errors";
import { InterviewActivityRegistry } from "./interview-activity-registry";
import {
  LOCAL_WORKSPACE_EMAIL,
  LOCAL_WORKSPACE_TENANT_ID,
  LOCAL_WORKSPACE_USER_ID,
  type Principal,
} from "./auth";
import {
  InterviewRepository,
  type TranscriptCaptureMetadata,
} from "./interview-repository";
import {
  PlatformRepository,
  type MessageCommandStage,
  type RealtimeEventDraft,
} from "./platform-repository";
import type {
  TranscriptCorrectionReprocessingContext,
  TranscriptCorrectionReprocessingEventDraft,
  TranscriptCorrectionReprocessingResult,
} from "./transcript-correction-service";

const MESSAGE_PROVIDER_LEASE_MS = 5 * 60 * 1_000;
const MAX_ADAPTIVE_QUESTION_LENGTH = 600;

/**
 * The server always selects the required information code and reason. Claude may
 * only make the wording warmer or more context-aware for that exact next step.
 */
function withAdaptiveQuestionText(
  selected: NextQuestion | null,
  proposed: NextQuestion | null,
): NextQuestion | null {
  if (!selected || !proposed || proposed.infoCode !== selected.infoCode) {
    return selected;
  }
  const text = proposed.text.trim();
  if (text.length < 2 || text.length > MAX_ADAPTIVE_QUESTION_LENGTH) {
    return selected;
  }
  return { ...selected, text };
}

function exhaustedFollowupCodes(
  currentInfoCode: string | null,
  items: readonly InformationItem[],
): string[] {
  if (!currentInfoCode) return [];
  const current = items.find((item) => item.infoCode === currentInfoCode);
  // NEEDS_FOLLOWUP means the initial answer was already heard and the next
  // answer is the single permitted clarification attempt.
  return current?.status === "NEEDS_FOLLOWUP" ? [current.infoCode] : [];
}

export interface InterviewServiceOptions {
  now?: () => Date;
  idFactory?: () => string;
  turnPlanner?: InterviewTurnPlanner;
  asyncTurnPlanner?: AsyncInterviewTurnPlanner;
  beforeAsyncStage?: (context: AsyncStagingContext) => void | Promise<void>;
  beforeAsyncPlan?: (context: AsyncPlanningContext) => void | Promise<void>;
  evaluationBuilder?: typeof buildInterviewDataQualityEvaluationV1;
}

export interface InterviewTurnPlanner {
  plan: (
    input: Parameters<typeof planDeterministicInterviewTurn>[0],
  ) => ReturnType<typeof planDeterministicInterviewTurn>;
}

export type TurnPlannerMetadata = TurnPlannerProcessingMetadata;

export interface AsyncInterviewTurnPlanningResult {
  plan: DeterministicTurnPlan;
  metadata: TurnPlannerMetadata;
}

export interface AsyncInterviewTurnPlanner {
  plan: (input: OrchestratorTurnInput) => Promise<AsyncInterviewTurnPlanningResult>;
}

export interface AsyncStagingContext {
  interviewId: string;
  principal: Principal;
}

export interface AsyncPlanningContext extends AsyncStagingContext {
  transcriptSegmentId: string;
}

export interface InterviewCreationProfile {
  borrowerName?: string;
  businessName?: string;
}

export interface MessageCommand {
  text: string;
  clientMessageId: string;
  expectedVersion: number;
  currentQuestionInfoCode: string | null;
  transcriptMetadata?: Omit<TranscriptCaptureMetadata, "rawText"> | null;
}

export interface PendingMessageCommandDescriptor {
  clientMessageId: string;
  text: string;
  expectedVersion: number;
  currentQuestionInfoCode: string | null;
  transcriptMetadata: {
    startMs: number | null;
    endMs: number | null;
    sttConfidence: number | null;
    sttProvider: string | null;
  } | null;
  processingState: "READY" | "PROCESSING";
}

export interface CompleteCommand {
  clientCommandId: string;
  expectedVersion: number;
  mode: "COMPLETE" | "FORCE_INCOMPLETE";
  borrowerConfirmed: boolean;
  reason: string | null;
  improvementChoice?: BorrowerImprovementChoice | null;
}

type LivePlatformSnapshot = LiveInterviewSnapshot & {
  snapshotType: "PREVIEW";
  canonicalInformationItems: CanonicalInformationRecord[];
  features: LiveFeatureSet & { snapshotType: "PREVIEW" };
  improvementFeatures: FeatureV2Set;
  liveSummary: EvidenceLinkedSummary & { snapshotType: "PREVIEW" };
  goalSnapshot: GoalSnapshot;
  pendingCommand: PendingMessageCommandDescriptor | null;
};

type LiveSnapshotWithEventSequence = LivePlatformSnapshot & {
  session: LiveInterviewSnapshot["session"] & { lastEventSeq: number };
};

type CanonicalFinalSnapshot = ImmutableFinalInterviewSnapshotV1 & {
  version: number;
  coverage: Coverage & { snapshotType: "FINAL" };
  legacyInformationItems: InformationItem[];
  transcriptSummary: string;
};

type StoredFinalSnapshot = FinalInterviewSnapshot | CanonicalFinalSnapshot;

type FinalSnapshotApiView = StoredFinalSnapshot & {
  evaluationId: string | null;
  improvementFeatures: FeatureV2Set | null;
  session: {
    id: string;
    lifecycleStatus: "COMPLETE" | "INCOMPLETE";
    snapshotType: "FINAL";
    version: number;
    createdAt: string;
    updatedAt: string;
    completedAt: string;
    lastEventSeq: number;
  };
};

type CanonicalEvaluationView = InterviewDataQualityEvaluationV1 & {
  id: string;
  interviewId: string;
  finalSnapshotId: string;
  snapshotVersion: number;
  createdAt: string;
};

export type InterviewApiSnapshot = LiveSnapshotWithEventSequence | FinalSnapshotApiView;

export type MessageCommandResult = Omit<MessageProcessingResult, "snapshot" | "processing"> & {
  snapshot: LiveSnapshotWithEventSequence;
  processing: MessageProcessingResult["processing"] & {
    metadata?: TurnPlannerMetadata;
  };
};

export interface CompleteCommandResult {
  snapshot: FinalSnapshotApiView;
  evaluation: InterviewEvaluation | CanonicalEvaluationView | null;
  evaluationEligibility: {
    eligible: boolean;
    blockers: string[];
    mode: CompleteCommand["mode"];
    reason: string | null;
  };
  improvementSelection: BorrowerImprovementSelection | null;
}

export interface EvaluationListQuery {
  q?: string | null;
  industry?: string | null;
  level?: "A" | "B" | "C" | "D" | "E" | "UNGRADED" | null;
  from?: string | null;
  to?: string | null;
  limit?: number;
  offset?: number;
}

export interface EvaluationListItem {
  id: string;
  interviewId: string;
  status: "PENDING" | "GENERATING" | "READY" | "FAILED";
  createdAt: string;
  completedAt: string | null;
  borrowerName: string;
  businessName: string;
  industry: string;
  overallScore: number;
  overallLevel: "A" | "B" | "C" | "D" | "E" | "UNGRADED";
  overallLevelLabel: string;
  informationRate: number;
  goalCount: number;
  completionStatus: "COMPLETE" | "INCOMPLETE";
  decisionScope: "INTERVIEW_DATA_QUALITY_ONLY";
}

export interface EvaluationListResult {
  items: EvaluationListItem[];
  total: number;
  facets: {
    industries: string[];
    levels: EvaluationListItem["overallLevel"][];
  };
}

const LOCAL_WORKSPACE_PRINCIPAL: Principal = {
  tenantId: LOCAL_WORKSPACE_TENANT_ID,
  userId: LOCAL_WORKSPACE_USER_ID,
  email: LOCAL_WORKSPACE_EMAIL,
  displayName: "로컬 작업공간 담당자",
  roles: ["ADMIN", "INTERVIEWER"],
};

function isMoneyValue(value: unknown): value is MoneyValue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MoneyValue>;
  return (
    typeof candidate.amount === "number" &&
    candidate.currency === "KRW" &&
    (candidate.period === "MONTH" || candidate.period === "ONE_TIME")
  );
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function dataQualityGrade(value: unknown): EvaluationListItem["overallLevel"] {
  return value === "A" || value === "B" || value === "C" || value === "D" ||
    value === "E" || value === "UNGRADED"
    ? value
    : "UNGRADED";
}

function dataQualityLabel(grade: EvaluationListItem["overallLevel"]): string {
  const label = {
    A: "데이터 품질 A · 우수",
    B: "데이터 품질 B · 양호",
    C: "데이터 품질 C · 보통",
    D: "데이터 품질 D · 보완 필요",
    E: "데이터 품질 E · 낮음",
    UNGRADED: "데이터 품질 미산출",
  } as const;
  return label[grade];
}

function percentage(value: unknown): number {
  const number = finiteNumber(value, 0);
  const percent = number <= 1 ? number * 100 : number;
  return Math.round(Math.min(100, Math.max(0, percent)));
}

function withInferredSalesChannels(
  value: CanonicalInformationValue | null,
  text: string,
): CanonicalInformationValue | null {
  if (value?.kind !== "PERIODIC_MONEY" || value.basis !== "GROSS_SALES") return value;
  const channels = [
    ...(/카드/.test(text) ? ["CARD"] : []),
    ...(/(현금|cash)/i.test(text) ? ["CASH"] : []),
    ...(/(배달|delivery)/i.test(text) ? ["DELIVERY"] : []),
  ];
  return channels.length > 0 ? { ...value, channels: [...new Set(channels)] } : value;
}

function safePlannerMetadata(metadata: TurnPlannerMetadata): TurnPlannerMetadata {
  const safeText = (value: unknown, fallback: string, maximum: number): string => {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= maximum ? trimmed : fallback;
  };
  const safeNullableText = (value: unknown, maximum: number): string | null => {
    if (value === null || value === undefined) return null;
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    return trimmed && trimmed.length <= maximum ? trimmed : null;
  };
  const safeTokenCount = (value: unknown): number | null =>
    Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
  return {
    provider: safeText(metadata?.provider, "unknown", 40),
    model: safeText(metadata?.model, "unknown", 120),
    requestId: safeNullableText(metadata?.requestId, 160),
    inputTokens: safeTokenCount(metadata?.inputTokens),
    outputTokens: safeTokenCount(metadata?.outputTokens),
    stopReason: safeNullableText(metadata?.stopReason, 80),
  };
}

function safeFailureIdentity(error: unknown): { errorName: string; providerCode: string | null } {
  const safeIdentifier = (value: unknown): string | null =>
    typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(value)
      ? value
      : null;
  const candidate = error && typeof error === "object"
    ? error as { name?: unknown; code?: unknown }
    : null;
  return {
    errorName: safeIdentifier(candidate?.name) ?? "UnknownError",
    providerCode: safeIdentifier(candidate?.code),
  };
}

function isRetryableClaudeFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { name?: unknown; retryable?: unknown };
  return candidate.name === "ClaudeProviderError" && candidate.retryable === true;
}

export class InterviewService {
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly platformRepository: PlatformRepository;
  private readonly activityRegistry: InterviewActivityRegistry;
  private readonly turnPlanner: InterviewTurnPlanner;
  private readonly asyncTurnPlanner: AsyncInterviewTurnPlanner;
  private readonly beforeAsyncStage: (context: AsyncStagingContext) => void | Promise<void>;
  private readonly beforeAsyncPlan: (context: AsyncPlanningContext) => void | Promise<void>;
  private readonly inFlightMessageCommands = new Map<
    string,
    { requestHash: string; promise: Promise<MessageCommandResult> }
  >();
  private readonly interviewMessageQueueTails = new Map<string, Promise<void>>();
  private readonly evaluationBuilder: typeof buildInterviewDataQualityEvaluationV1;

  constructor(
    readonly repository: InterviewRepository,
    options: InterviewServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.platformRepository = new PlatformRepository(repository.database);
    this.activityRegistry = new InterviewActivityRegistry(repository.database);
    this.turnPlanner = createValidatedOrchestratorProvider(
      options.turnPlanner ?? { plan: planDeterministicInterviewTurn },
    );
    this.asyncTurnPlanner = options.asyncTurnPlanner ?? {
      plan: async (input) => ({
        plan: this.turnPlanner.plan(input),
        metadata: {
          provider: "deterministic",
          model: "local-dev-v1",
          requestId: null,
          inputTokens: null,
          outputTokens: null,
          stopReason: null,
        },
      }),
    };
    this.beforeAsyncStage = options.beforeAsyncStage ?? (() => undefined);
    this.beforeAsyncPlan = options.beforeAsyncPlan ?? (() => undefined);
    this.evaluationBuilder =
      options.evaluationBuilder ?? buildInterviewDataQualityEvaluationV1;
  }

  createInterview(
    principal: Principal = LOCAL_WORKSPACE_PRINCIPAL,
    suppliedRequiredItems: readonly RequiredInformationItem[] | null = null,
    industryCode: SohoIndustryCode = "CAFE",
    creationProfile: InterviewCreationProfile = {},
  ): LiveSnapshotWithEventSequence {
    const industryProfile = findSohoIndustryProfile(industryCode);
    if (!industryProfile) {
      throw new ApplicationError(
        422,
        "UNSUPPORTED_INDUSTRY",
        "지원하지 않는 SOHO 업종입니다.",
        { industryCode },
      );
    }
    const requiredItems = (suppliedRequiredItems ?? createDevV1RequiredInformationItems()).map(
      (item) => ({
        ...item,
        evidencePreference: [...item.evidencePreference],
        dependencies: [...item.dependencies],
      }),
    );
    const catalogIssues = validateRequiredInformationCatalog(requiredItems, {
      requireDevV1Codes: true,
    });
    const invalidInitialStatuses = requiredItems
      .filter((item) => !["NEEDED", "ASKING"].includes(item.status))
      .map((item) => item.infoCode);
    const askingItems = requiredItems.filter((item) => item.status === "ASKING");
    if (
      catalogIssues.length > 0 ||
      invalidInitialStatuses.length > 0 ||
      askingItems.length > 1
    ) {
      throw new ApplicationError(
        422,
        "INVALID_REQUIRED_INFORMATION_LIST",
        "인터뷰 시작용 필요정보 목록 검증에 실패했습니다.",
        {
          issues: catalogIssues,
          invalidInitialStatuses,
          askingInfoCodes: askingItems.map((item) => item.infoCode),
        },
      );
    }
    const now = this.timestamp();
    const interviewId = this.idFactory();
    const borrowerId = this.idFactory();
    const businessId = this.idFactory();
    let informationItems: InformationItem[] = requiredItems.map((item) => ({
        ...item,
        valueState: "MISSING",
        value: null,
        quality: null,
        extractionConfidence: null,
        verification: null,
        evidenceIds: [],
        prefill: null,
        updatedAt: now,
      }));
    const suppliedAskingCode = askingItems[0]?.infoCode ?? null;
    const initialQuestion = selectNextQuestion(informationItems, suppliedAskingCode);
    if (!initialQuestion) {
      throw new ApplicationError(
        422,
        "INVALID_REQUIRED_INFORMATION_LIST",
        "인터뷰를 시작할 질문을 선택할 수 없습니다.",
      );
    }
    informationItems = informationItems.map((item) => ({
      ...item,
      status:
        item.infoCode === initialQuestion.infoCode
          ? "ASKING"
          : item.status === "ASKING"
            ? "NEEDED"
            : item.status,
    }));
    const transcript: TranscriptSegment = {
      id: this.idFactory(),
      interviewId,
      sequence: 1,
      speaker: "ASSISTANT",
      text: initialQuestion.text,
      confirmation: "FINAL",
      createdAt: now,
    };
    return this.repository.transaction(() => {
      this.repository.createInterview({
        session: {
          id: interviewId,
          lifecycleStatus: "ACTIVE",
          snapshotType: "PREVIEW",
          version: 1,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
        },
        borrower: {
          id: borrowerId,
          name: creationProfile.borrowerName?.trim() || "사장님",
        },
        business: {
          id: businessId,
          borrowerId,
          businessName: creationProfile.businessName?.trim() || `${industryProfile.label} 사업체`,
          industry: industryProfile.label,
        },
        informationItems,
        transcript,
        prefillEvidence: null,
        currentQuestionCode: initialQuestion.infoCode,
        tenantId: principal.tenantId,
        ownerUserId: principal.userId,
      });
      const snapshot = this.enhanceLiveSnapshot(
        this.getLiveSnapshot(interviewId, true),
        principal.tenantId,
        now,
      );
      this.repository.replaceLiveFeatures(
        principal.tenantId,
        interviewId,
        snapshot.features,
        now,
      );
      const events = this.platformRepository.appendOutboxEvents({
        tenantId: principal.tenantId,
        interviewId,
        aggregateVersion: snapshot.session.version,
        turnId: `create:${interviewId}`,
        now,
        eventIdFactory: this.idFactory,
        drafts: [
          {
            type: "coverage.changed",
            snapshotType: "PREVIEW",
            data: { coverage: snapshot.coverage },
          },
          {
            type: "question.generated",
            snapshotType: "PREVIEW",
            data: { question: snapshot.nextQuestion },
          },
        ],
      });
      return this.withLiveEventSequence(snapshot, events.at(-1)?.seq ?? 0);
    });
  }

  getLiveSnapshot(interviewId: string, fullCatalog = false): LiveInterviewSnapshot {
    const stored = this.repository.getInterview(interviewId);
    const informationItems = this.repository.listInformationItems(interviewId);
    const transcript = this.repository.listTranscript(interviewId);
    const selectedNextQuestion =
      stored.session.lifecycleStatus === "ACTIVE"
        ? selectNextQuestion(
            fullCatalog
              ? informationItems
              : informationItems.filter((item) => item.infoCode === "monthly_average_sales"),
            stored.currentQuestionCode,
          )
        : null;
    // The selected code remains deterministic, while the last assistant turn
    // preserves an approved, context-aware phrasing through reload/SSE recovery.
    const latestAssistantText = transcript
      .filter((segment) => segment.speaker === "ASSISTANT")
      .at(-1)?.text.trim();
    const nextQuestion =
      selectedNextQuestion && latestAssistantText
        ? { ...selectedNextQuestion, text: latestAssistantText }
        : selectedNextQuestion;
    return {
      session: { ...stored.session, snapshotType: "PREVIEW" },
      borrower: stored.borrower,
      business: stored.business,
      informationItems,
      transcript,
      evidence: this.repository.listEvidence(interviewId),
      coverage: { ...calculateCoverage(informationItems, "PREVIEW"), snapshotType: "PREVIEW" },
      nextQuestion,
    };
  }

  getInterviewSnapshot(interviewId: string, principal: Principal): InterviewApiSnapshot {
    const aggregate = this.platformRepository.getInterviewAggregate(
      principal.tenantId,
      interviewId,
    );
    if (aggregate.lifecycleStatus === "ACTIVE") {
      return this.withLiveEventSequence(
        this.withDurablePendingCommand(
          this.enhanceLiveSnapshot(
            this.getLiveSnapshot(interviewId, true),
            principal.tenantId,
            this.timestamp(),
          ),
          principal.tenantId,
        ),
        aggregate.lastEventSeq,
      );
    }
    const snapshot = this.repository.getFinalSnapshot<StoredFinalSnapshot>(interviewId);
    if (!snapshot) {
      throw new ApplicationError(
        409,
        "INTERVIEW_FINALIZED_WITHOUT_SNAPSHOT",
        "종료된 인터뷰의 FINAL snapshot을 찾을 수 없습니다.",
      );
    }
    return this.withFinalSession(snapshot, aggregate.lastEventSeq, principal.tenantId);
  }

  getRealtimeEvents(principal: Principal, interviewId: string, after: number) {
    return this.platformRepository.listOutboxEventsAfter(
      principal.tenantId,
      interviewId,
      after,
    );
  }

  getRealtimeReplayBounds(principal: Principal, interviewId: string) {
    return this.platformRepository.getReplayBounds(principal.tenantId, interviewId);
  }

  addMessageCommand(
    interviewId: string,
    command: MessageCommand,
    principal: Principal,
  ): MessageCommandResult {
    const now = this.timestamp();
    const requestHash = this.commandHash(command);
    return this.repository.transaction(() => {
      this.platformRepository.getInterviewAggregate(principal.tenantId, interviewId);
      const existing = this.platformRepository.getCommandReceipt<MessageCommandResult>(
        principal.tenantId,
        interviewId,
        "MESSAGE",
        command.clientMessageId,
      );
      if (existing) {
        this.platformRepository.assertReceiptMatches(existing.requestHash, requestHash);
        return existing.response;
      }

      const resultingVersion = this.platformRepository.advanceMessageVersion({
        tenantId: principal.tenantId,
        interviewId,
        expectedVersion: command.expectedVersion,
        currentQuestionCode: command.currentQuestionInfoCode,
        now,
      });
      const processedBase = this.processCanonicalMessage(
        interviewId,
        command.text,
        principal,
        resultingVersion,
        now,
        command.transcriptMetadata,
      );
      const enhancedSnapshot = this.enhanceLiveSnapshot(
        processedBase.snapshot,
        principal.tenantId,
        now,
      );
      this.repository.replaceLiveFeatures(
        principal.tenantId,
        interviewId,
        enhancedSnapshot.features,
        now,
      );
      const processed = { ...processedBase, snapshot: enhancedSnapshot };
      const drafts = this.messageEventDrafts(processed, principal.tenantId);
      const events = this.platformRepository.appendOutboxEvents({
        tenantId: principal.tenantId,
        interviewId,
        aggregateVersion: resultingVersion,
        turnId: command.clientMessageId,
        now,
        eventIdFactory: this.idFactory,
        drafts,
      });
      const response: MessageCommandResult = {
        ...processed,
        snapshot: this.withLiveEventSequence(
          processed.snapshot,
          events.at(-1)?.seq ??
            this.platformRepository.getInterviewAggregate(principal.tenantId, interviewId)
              .lastEventSeq,
        ),
      };
      this.platformRepository.insertCommandReceipt({
        id: this.idFactory(),
        tenantId: principal.tenantId,
        interviewId,
        commandType: "MESSAGE",
        clientCommandId: command.clientMessageId,
        requestHash,
        expectedVersion: command.expectedVersion,
        resultingVersion,
        response,
        now,
      });
      return response;
    });
  }

  async addMessageCommandAsync(
    interviewId: string,
    command: MessageCommand,
    principal: Principal,
  ): Promise<MessageCommandResult> {
    const requestHash = this.commandHash(command);
    const inFlightKey = JSON.stringify([
      principal.tenantId,
      interviewId,
      command.clientMessageId,
    ]);
    const existing = this.inFlightMessageCommands.get(inFlightKey);
    if (existing) {
      this.platformRepository.assertReceiptMatches(existing.requestHash, requestHash);
      return existing.promise;
    }
    const queueKey = JSON.stringify([principal.tenantId, interviewId]);
    const previousTail = this.interviewMessageQueueTails.get(queueKey) ?? Promise.resolve();
    const promise = previousTail
      .catch(() => undefined)
      .then(() =>
        this.executeMessageCommandAsync(
          interviewId,
          command,
          principal,
          requestHash,
        ),
      );
    const queueTail = promise.then(
      () => undefined,
      () => undefined,
    );
    this.interviewMessageQueueTails.set(queueKey, queueTail);
    this.inFlightMessageCommands.set(inFlightKey, { requestHash, promise });
    try {
      return await promise;
    } finally {
      const current = this.inFlightMessageCommands.get(inFlightKey);
      if (current?.promise === promise) this.inFlightMessageCommands.delete(inFlightKey);
      if (this.interviewMessageQueueTails.get(queueKey) === queueTail) {
        this.interviewMessageQueueTails.delete(queueKey);
      }
    }
  }

  private async executeMessageCommandAsync(
    interviewId: string,
    command: MessageCommand,
    principal: Principal,
    requestHash: string,
  ): Promise<MessageCommandResult> {
    const text = command.text.trim();
    if (!text || text.length > 5_000) {
      throw new ApplicationError(
        400,
        "INVALID_MESSAGE_TEXT",
        "text는 1자 이상 5,000자 이하의 문자열이어야 합니다.",
      );
    }
    const existingReceipt = this.platformRepository.getCommandReceipt<MessageCommandResult>(
      principal.tenantId,
      interviewId,
      "MESSAGE",
      command.clientMessageId,
    );
    if (existingReceipt) {
      this.platformRepository.assertReceiptMatches(existingReceipt.requestHash, requestHash);
      return existingReceipt.response;
    }

    const unresolvedStage = this.platformRepository.getPendingMessageCommandStage(
      principal.tenantId,
      interviewId,
    );
    if (
      unresolvedStage &&
      unresolvedStage.clientMessageId !== command.clientMessageId
    ) {
      throw new ApplicationError(
        409,
        "MESSAGE_STAGE_PENDING",
        "A previous answer is still waiting for Claude processing.",
        { pendingClientMessageId: unresolvedStage.clientMessageId },
      );
    }

    const pendingStageBeforeConsent = this.platformRepository.getMessageCommandStage(
      principal.tenantId,
      interviewId,
      command.clientMessageId,
    );
    if (pendingStageBeforeConsent) {
      try {
        this.assertPendingMessageStageCurrent(
          pendingStageBeforeConsent,
          principal,
          requestHash,
        );
      } catch (error) {
        if (error instanceof ApplicationError && error.code === "MESSAGE_STAGE_STALE") {
          this.platformRepository.failMessageCommandStageIfPending({
            tenantId: principal.tenantId,
            interviewId,
            clientMessageId: command.clientMessageId,
            failureCode: "MESSAGE_STAGE_STALE",
            now: this.timestamp(),
          });
        }
        throw error;
      }
    }

    // Cloud-processing consent and equivalent preconditions must be checked
    // before the atomic transcript/stage commit. This prevents a rejected
    // request from leaving an orphan PENDING stage that a UI retry duplicates.
    await this.beforeAsyncStage({ interviewId, principal });

    const stage = this.repository.transaction(() => {
      const existingReceipt = this.platformRepository.getCommandReceipt<MessageCommandResult>(
        principal.tenantId,
        interviewId,
        "MESSAGE",
        command.clientMessageId,
      );
      if (existingReceipt) {
        this.platformRepository.assertReceiptMatches(existingReceipt.requestHash, requestHash);
        return { kind: "RECEIPT" as const, response: existingReceipt.response };
      }

      const existingStage = this.platformRepository.getMessageCommandStage(
        principal.tenantId,
        interviewId,
        command.clientMessageId,
      );
      if (existingStage) {
        this.assertPendingMessageStageCurrent(existingStage, principal, requestHash);
        return {
          kind: "STAGED" as const,
          acceptedTranscript: this.getStagedTranscript(
            interviewId,
            existingStage.transcriptSegmentId,
          ),
          planningInput: {
            text,
            currentInfoCode: existingStage.currentQuestionCode,
            informationItems: this.repository.listInformationItems(interviewId),
            followupExhaustedInfoCodes: exhaustedFollowupCodes(
              existingStage.currentQuestionCode,
              this.repository.listInformationItems(interviewId),
            ),
          } satisfies OrchestratorTurnInput,
        };
      }


      const competingStage = this.platformRepository.getPendingMessageCommandStage(
        principal.tenantId,
        interviewId,
      );
      if (competingStage) {
        throw new ApplicationError(
          409,
          "MESSAGE_STAGE_PENDING",
          "A previous answer is still waiting for Claude processing.",
          { pendingClientMessageId: competingStage.clientMessageId },
        );
      }

      this.platformRepository.assertMessagePreconditions({
        tenantId: principal.tenantId,
        interviewId,
        expectedVersion: command.expectedVersion,
        currentQuestionCode: command.currentQuestionInfoCode,
      });
      const now = this.timestamp();
      const acceptedTranscript: TranscriptSegment = {
        id: this.idFactory(),
        interviewId,
        sequence: this.repository.nextTranscriptSequence(interviewId),
        speaker: "BORROWER",
        text,
        confirmation: "FINAL",
        createdAt: now,
      };
      this.repository.insertTranscript(acceptedTranscript, {
        ...command.transcriptMetadata,
        rawText: text,
      });
      this.platformRepository.insertMessageCommandStage({
        id: this.idFactory(),
        tenantId: principal.tenantId,
        interviewId,
        clientMessageId: command.clientMessageId,
        requestHash,
        expectedVersion: command.expectedVersion,
        currentQuestionCode: command.currentQuestionInfoCode,
        transcriptSegmentId: acceptedTranscript.id,
        transcriptMetadata: command.transcriptMetadata
          ? {
              startMs: command.transcriptMetadata.startMs ?? null,
              endMs: command.transcriptMetadata.endMs ?? null,
              sttConfidence: command.transcriptMetadata.sttConfidence ?? null,
              sttProvider: command.transcriptMetadata.sttProvider?.trim() || null,
            }
          : null,
        now,
      });
      const informationItems = this.repository.listInformationItems(interviewId);
      return {
        kind: "STAGED" as const,
        acceptedTranscript,
        planningInput: {
          text,
          currentInfoCode: command.currentQuestionInfoCode,
          informationItems,
          followupExhaustedInfoCodes: exhaustedFollowupCodes(
            command.currentQuestionInfoCode,
            informationItems,
          ),
        } satisfies OrchestratorTurnInput,
      };
    });
    if (stage.kind === "RECEIPT") return stage.response;

    this.assertPendingMessageStageCurrentById(
      interviewId,
      command.clientMessageId,
      principal,
      requestHash,
    );

    // Recheck consent/policy immediately before the provider request to close
    // the staging-to-network TOCTOU window. A rejection leaves the durable
    // transcript and PENDING stage available for an explicit later resume.
    await this.beforeAsyncPlan({
      interviewId,
      principal,
      transcriptSegmentId: stage.acceptedTranscript.id,
    });

    // Consent/policy hooks may await external state. Revalidate the staged CAS
    // immediately before the paid call so an older PENDING command never
    // reaches the provider after another command has advanced this interview.
    this.assertPendingMessageStageCurrentById(
      interviewId,
      command.clientMessageId,
      principal,
      requestHash,
    );

    const leaseToken = randomUUID();
    const leaseNow = this.timestamp();
    this.platformRepository.claimMessageCommandStage({
      tenantId: principal.tenantId,
      interviewId,
      clientMessageId: command.clientMessageId,
      leaseToken,
      now: leaseNow,
      leaseExpiresAt: new Date(
        new Date(leaseNow).getTime() + MESSAGE_PROVIDER_LEASE_MS,
      ).toISOString(),
    });

    // The provider request intentionally executes after the transcript commit
    // and with no SQLite transaction held.
    let planning: AsyncInterviewTurnPlanningResult;
    let receivedMetadata: TurnPlannerMetadata | undefined;
    try {
      const providerResult = await this.asyncTurnPlanner.plan(stage.planningInput);
      receivedMetadata = safePlannerMetadata(providerResult.metadata);
      planning = {
        plan: assertOrchestratorTurnPlan(providerResult.plan, stage.planningInput),
        metadata: receivedMetadata,
      };
    } catch (error) {
      return this.finishAsyncMessageFailure({
        interviewId,
        command,
        principal,
        requestHash,
        acceptedTranscript: stage.acceptedTranscript,
        error,
        providerMetadata: receivedMetadata,
        leaseToken,
      });
    }

    try {
      const now = this.timestamp();
      return this.repository.transaction(() => {
        const existingReceipt = this.platformRepository.getCommandReceipt<MessageCommandResult>(
          principal.tenantId,
          interviewId,
          "MESSAGE",
          command.clientMessageId,
        );
        if (existingReceipt) {
          this.platformRepository.assertReceiptMatches(existingReceipt.requestHash, requestHash);
          return existingReceipt.response;
        }
        const pendingStage = this.platformRepository.getMessageCommandStage(
          principal.tenantId,
          interviewId,
          command.clientMessageId,
        );
        if (!pendingStage || pendingStage.status !== "PENDING") {
          throw new ApplicationError(
            409,
            "MESSAGE_STAGE_CONFLICT",
            "메시지 처리 단계가 이미 완료되었거나 존재하지 않습니다.",
          );
        }
        this.platformRepository.assertReceiptMatches(pendingStage.requestHash, requestHash);
        const resultingVersion = this.platformRepository.advanceMessageVersion({
          tenantId: principal.tenantId,
          interviewId,
          expectedVersion: command.expectedVersion,
          currentQuestionCode: command.currentQuestionInfoCode,
          now,
        });
        const processedBase = this.processCanonicalMessage(
          interviewId,
          command.text,
          principal,
          resultingVersion,
          now,
          command.transcriptMetadata,
          { acceptedTranscript: stage.acceptedTranscript, plan: planning.plan },
        );
        const enhancedSnapshot = this.enhanceLiveSnapshot(
          processedBase.snapshot,
          principal.tenantId,
          now,
        );
        this.repository.replaceLiveFeatures(
          principal.tenantId,
          interviewId,
          enhancedSnapshot.features,
          now,
        );
        const processed = {
          ...processedBase,
          snapshot: enhancedSnapshot,
          processing: {
            ...processedBase.processing,
            metadata: planning.metadata,
          },
        };
        const drafts = this.messageEventDrafts(processed, principal.tenantId);
        const events = this.platformRepository.appendOutboxEvents({
          tenantId: principal.tenantId,
          interviewId,
          aggregateVersion: resultingVersion,
          turnId: command.clientMessageId,
          now,
          eventIdFactory: this.idFactory,
          drafts,
        });
        const response: MessageCommandResult = {
          ...processed,
          snapshot: this.withLiveEventSequence(
            processed.snapshot,
            events.at(-1)?.seq ??
              this.platformRepository.getInterviewAggregate(principal.tenantId, interviewId)
                .lastEventSeq,
          ),
        };
        this.platformRepository.insertCommandReceipt({
          id: this.idFactory(),
          tenantId: principal.tenantId,
          interviewId,
          commandType: "MESSAGE",
          clientCommandId: command.clientMessageId,
          requestHash,
          expectedVersion: command.expectedVersion,
          resultingVersion,
          response,
          now,
        });
        this.platformRepository.finishMessageCommandStage({
          tenantId: principal.tenantId,
          interviewId,
          clientMessageId: command.clientMessageId,
          status: "APPLIED",
          providerMetadata: { ...planning.metadata },
          failureCode: null,
          leaseToken,
          now,
        });
        return response;
      });
    } catch (error) {
      return this.finishAsyncMessageFailure({
        interviewId,
        command,
        principal,
        requestHash,
        acceptedTranscript: stage.acceptedTranscript,
        error,
        providerMetadata: planning.metadata,
        leaseToken,
      });
    }
  }

  private finishAsyncMessageFailure(input: {
    interviewId: string;
    command: MessageCommand;
    principal: Principal;
    requestHash: string;
    acceptedTranscript: TranscriptSegment;
    error: unknown;
    providerMetadata?: TurnPlannerMetadata;
    leaseToken: string;
  }): MessageCommandResult {
    const now = this.timestamp();
    const failureIdentity = safeFailureIdentity(input.error);
    const retryable = isRetryableClaudeFailure(input.error);
    return this.repository.transaction(() => {
      const existingReceipt = this.platformRepository.getCommandReceipt<MessageCommandResult>(
        input.principal.tenantId,
        input.interviewId,
        "MESSAGE",
        input.command.clientMessageId,
      );
      if (existingReceipt) {
        this.platformRepository.assertReceiptMatches(
          existingReceipt.requestHash,
          input.requestHash,
        );
        return existingReceipt.response;
      }
      const pendingStage = this.platformRepository.getMessageCommandStage(
        input.principal.tenantId,
        input.interviewId,
        input.command.clientMessageId,
      );
      if (!pendingStage || pendingStage.status !== "PENDING") {
        throw new ApplicationError(
          409,
          "MESSAGE_STAGE_CONFLICT",
          "메시지 처리 실패를 기록할 처리 단계를 찾을 수 없습니다.",
        );
      }
      this.platformRepository.assertReceiptMatches(
        pendingStage.requestHash,
        input.requestHash,
      );
      const aggregate = this.platformRepository.getInterviewAggregate(
        input.principal.tenantId,
        input.interviewId,
      );
      if (aggregate.lifecycleStatus !== "ACTIVE") {
        throw new ApplicationError(
          409,
          "INTERVIEW_FINALIZED",
          "종료된 인터뷰에는 메시지 처리 실패 결과를 적용할 수 없습니다.",
        );
      }
      if (retryable) {
        this.platformRepository.releaseMessageCommandStageClaim({
          tenantId: input.principal.tenantId,
          interviewId: input.interviewId,
          clientMessageId: input.command.clientMessageId,
          leaseToken: input.leaseToken,
        });
      }
      const firstEventSequence = this.repository.nextEventSequence(input.interviewId) - 1;
      const baseSnapshot = this.enhanceLiveSnapshot(
        this.getLiveSnapshot(input.interviewId, true),
        input.principal.tenantId,
        now,
      );
      const snapshot = retryable
        ? this.withDurablePendingCommand(baseSnapshot, input.principal.tenantId)
        : baseSnapshot;
      const processed = {
        snapshot,
        stateChanges: this.repository.listEventsAfter(
          input.interviewId,
          firstEventSequence,
        ),
        evidenceAdded: [],
        acceptedTranscript: input.acceptedTranscript,
        processing: {
          status: retryable
            ? "RETRYABLE_FAILURE" as const
            : "NON_RETRYABLE_FAILURE" as const,
          code: retryable
            ? "TURN_PROCESSING_FAILED"
            : "TURN_PROCESSING_REJECTED",
          ...(input.providerMetadata ? { metadata: input.providerMetadata } : {}),
        },
      };
      const events = this.platformRepository.appendOutboxEvents({
        tenantId: input.principal.tenantId,
        interviewId: input.interviewId,
        aggregateVersion: aggregate.version,
        turnId: input.command.clientMessageId,
        now,
        eventIdFactory: this.idFactory,
        drafts: this.messageEventDrafts(processed, input.principal.tenantId),
      });
      const response: MessageCommandResult = {
        ...processed,
        snapshot: this.withLiveEventSequence(
          snapshot,
          events.at(-1)?.seq ?? aggregate.lastEventSeq,
        ),
      };
      this.repository.insertAuditEvent(
        this.idFactory(),
        input.interviewId,
        "TURN_PROCESSING_FAILED",
        {
          transcriptSegmentId: input.acceptedTranscript.id,
          retryable,
          failureCode: retryable
            ? "TURN_PROCESSING_FAILED"
            : "TURN_PROCESSING_REJECTED",
          errorName: failureIdentity.errorName,
          providerCode: failureIdentity.providerCode,
          provider: input.providerMetadata?.provider ?? null,
          model: input.providerMetadata?.model ?? null,
        },
        now,
      );
      if (!retryable) {
        this.platformRepository.finishMessageCommandStage({
          tenantId: input.principal.tenantId,
          interviewId: input.interviewId,
          clientMessageId: input.command.clientMessageId,
          status: "FAILED",
          providerMetadata: input.providerMetadata
            ? { ...input.providerMetadata }
            : null,
          failureCode: "TURN_PROCESSING_REJECTED",
          leaseToken: input.leaseToken,
          now,
        });
        this.platformRepository.insertCommandReceipt({
          id: this.idFactory(),
          tenantId: input.principal.tenantId,
          interviewId: input.interviewId,
          commandType: "MESSAGE",
          clientCommandId: input.command.clientMessageId,
          requestHash: input.requestHash,
          expectedVersion: input.command.expectedVersion,
          resultingVersion: aggregate.version,
          response,
          now,
        });
      }
      // RETRYABLE_FAILURE deliberately has no receipt and keeps PENDING so an
      // explicit identical retry can reuse this FINAL transcript. A terminal
      // provider rejection is FAILED and receipt-cached at the same version.
      return response;
    });
  }

  private getStagedTranscript(
    interviewId: string,
    transcriptSegmentId: string,
  ): TranscriptSegment {
    const transcript = this.repository
      .listTranscript(interviewId)
      .find((segment) => segment.id === transcriptSegmentId);
    if (!transcript || transcript.speaker !== "BORROWER" || transcript.confirmation !== "FINAL") {
      throw new ApplicationError(
        500,
        "MESSAGE_STAGE_TRANSCRIPT_MISSING",
        "메시지 처리 단계에 연결된 FINAL transcript를 찾을 수 없습니다.",
      );
    }
    return transcript;
  }

  private assertPendingMessageStageCurrentById(
    interviewId: string,
    clientMessageId: string,
    principal: Principal,
    requestHash: string,
  ): MessageCommandStage {
    const stage = this.platformRepository.getMessageCommandStage(
      principal.tenantId,
      interviewId,
      clientMessageId,
    );
    if (!stage) {
      throw new ApplicationError(
        409,
        "MESSAGE_STAGE_CONFLICT",
        "메시지 처리 단계를 찾을 수 없습니다.",
      );
    }
    try {
      return this.assertPendingMessageStageCurrent(stage, principal, requestHash);
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "MESSAGE_STAGE_STALE") {
        this.platformRepository.failMessageCommandStageIfPending({
          tenantId: principal.tenantId,
          interviewId,
          clientMessageId,
          failureCode: "MESSAGE_STAGE_STALE",
          now: this.timestamp(),
        });
      }
      throw error;
    }
  }

  private assertPendingMessageStageCurrent(
    stage: MessageCommandStage,
    principal: Principal,
    requestHash: string,
  ): MessageCommandStage {
    this.platformRepository.assertReceiptMatches(stage.requestHash, requestHash);
    if (stage.status !== "PENDING") {
      if (
        stage.status === "FAILED" &&
        (stage.failureCode === "MESSAGE_STAGE_STALE" ||
          stage.failureCode === "MESSAGE_STAGE_SUPERSEDED")
      ) {
        throw new ApplicationError(
          409,
          "MESSAGE_STAGE_STALE",
          "The preserved answer no longer matches the current interview state.",
        );
      }
      throw new ApplicationError(
        500,
        "MESSAGE_STAGE_RECEIPT_MISSING",
        "완료된 메시지 처리 단계의 명령 영수증을 찾을 수 없습니다.",
      );
    }
    const aggregate = this.platformRepository.getInterviewAggregate(
      principal.tenantId,
      stage.interviewId,
    );
    if (
      aggregate.lifecycleStatus !== "ACTIVE" ||
      aggregate.version !== stage.expectedVersion ||
      aggregate.currentQuestionCode !== stage.currentQuestionCode
    ) {
      throw new ApplicationError(
        409,
        "MESSAGE_STAGE_STALE",
        "보류 중인 답변이 현재 인터뷰 버전 또는 질문과 일치하지 않습니다.",
        {
          expectedVersion: stage.expectedVersion,
          actualVersion: aggregate.version,
          expectedQuestionInfoCode: stage.currentQuestionCode,
          actualQuestionInfoCode: aggregate.currentQuestionCode,
          lifecycleStatus: aggregate.lifecycleStatus,
        },
      );
    }
    return stage;
  }

  addMessage(interviewId: string, rawText: string): MessageProcessingResult {
    const text = rawText.trim();
    if (!text || text.length > 5_000) {
      throw new ApplicationError(
        400,
        "INVALID_MESSAGE_TEXT",
        "text는 1자 이상 5,000자 이하의 문자열이어야 합니다.",
      );
    }

    const transactionResult = this.repository.transaction(() => {
      const stored = this.repository.getInterview(interviewId);
      if (stored.session.lifecycleStatus !== "ACTIVE") {
        throw new ApplicationError(
          409,
          "INTERVIEW_FINALIZED",
          "종료된 인터뷰의 PREVIEW 상태는 변경할 수 없습니다.",
        );
      }

      const now = this.timestamp();
      const firstEventSequence = this.repository.nextEventSequence(interviewId) - 1;
      let currentInfoCode = stored.currentQuestionCode;
      let currentItem = currentInfoCode
        ? this.repository.getInformationItem(interviewId, currentInfoCode)
        : null;

      if (currentItem && ["NEEDED", "NEEDS_FOLLOWUP", "CONFLICT"].includes(currentItem.status)) {
        this.repository.transitionStatus(
          interviewId,
          currentItem.infoCode,
          "ASKING",
          "현재 질문에 대한 차주 응답 수신",
          this.idFactory(),
          now,
        );
        currentItem = this.repository.getInformationItem(interviewId, currentItem.infoCode);
      }

      const acceptedTranscript: TranscriptSegment = {
        id: this.idFactory(),
        interviewId,
        sequence: this.repository.nextTranscriptSequence(interviewId),
        speaker: "BORROWER",
        text,
        confirmation: "FINAL",
        createdAt: now,
      };
      this.repository.insertTranscript(acceptedTranscript);

      const evidenceAdded: EvidenceRef[] = [];
      if (currentItem?.infoCode === "monthly_average_sales" && currentItem.status === "ASKING") {
        const evidence = this.processMonthlyAverageSales(
          interviewId,
          currentItem,
          acceptedTranscript,
          now,
        );
        evidenceAdded.push(evidence);
      }

      let informationItems = this.repository.listInformationItems(interviewId);
      const selectableItems = informationItems.filter(
        (item) => item.infoCode === "monthly_average_sales",
      );
      const answeredItem = currentInfoCode
        ? informationItems.find((item) => item.infoCode === currentInfoCode)
        : null;
      let nextQuestion = answeredItem
        ? selectNextQuestion(selectableItems, answeredItem.infoCode)
        : selectNextQuestion(selectableItems, null);

      if (
        answeredItem &&
        !["ASKING", "NEEDS_FOLLOWUP", "CONFLICT"].includes(answeredItem.status)
      ) {
        nextQuestion = selectNextQuestion(selectableItems, null);
      }

      currentInfoCode = nextQuestion?.infoCode ?? null;
      if (nextQuestion) {
        const nextItem = informationItems.find((item) => item.infoCode === nextQuestion?.infoCode);
        if (nextItem?.status === "NEEDED") {
          this.repository.transitionStatus(
            interviewId,
            nextItem.infoCode,
            "ASKING",
            "우선순위와 의존성을 반영한 다음 질문 선택",
            this.idFactory(),
            now,
          );
          informationItems = this.repository.listInformationItems(interviewId);
          nextQuestion = selectNextQuestion(
            informationItems.filter((item) => item.infoCode === "monthly_average_sales"),
            nextItem.infoCode,
          );
        }
      }
      this.repository.setCurrentQuestion(interviewId, currentInfoCode, now);

      if (nextQuestion) {
        this.repository.insertTranscript({
          id: this.idFactory(),
          interviewId,
          sequence: this.repository.nextTranscriptSequence(interviewId),
          speaker: "ASSISTANT",
          text: nextQuestion.text,
          confirmation: "FINAL",
          createdAt: now,
        });
      }

      return {
        acceptedTranscript,
        evidenceAdded,
        firstEventSequence,
      };
    });

    return {
      snapshot: this.getLiveSnapshot(interviewId),
      stateChanges: this.repository.listEventsAfter(
        interviewId,
        transactionResult.firstEventSequence,
      ),
      evidenceAdded: transactionResult.evidenceAdded,
      acceptedTranscript: transactionResult.acceptedTranscript,
      processing: { status: "APPLIED", code: null },
    };
  }

  private processCanonicalMessage(
    interviewId: string,
    rawText: string,
    principal: Principal,
    aggregateVersion: number,
    now: string,
    transcriptMetadata: Omit<TranscriptCaptureMetadata, "rawText"> | null = null,
    prepared: {
      acceptedTranscript: TranscriptSegment;
      plan: DeterministicTurnPlan;
    } | null = null,
  ): MessageProcessingResult {
    const text = rawText.trim();
    if (!text || text.length > 5_000) {
      throw new ApplicationError(
        400,
        "INVALID_MESSAGE_TEXT",
        "text는 1자 이상 5,000자 이하의 문자열이어야 합니다.",
      );
    }
    const stored = this.repository.getInterview(interviewId);
    if (stored.session.lifecycleStatus !== "ACTIVE") {
      throw new ApplicationError(
        409,
        "INTERVIEW_FINALIZED",
        "종료된 인터뷰의 PREVIEW 상태는 변경할 수 없습니다.",
      );
    }

    const firstEventSequence = this.repository.nextEventSequence(interviewId) - 1;
    const informationItems = this.repository.listInformationItems(interviewId);
    const records = this.ensureCanonicalRecords(
      principal.tenantId,
      interviewId,
      informationItems,
      aggregateVersion,
      now,
    );
    const acceptedTranscript: TranscriptSegment = prepared?.acceptedTranscript ?? {
      id: this.idFactory(),
      interviewId,
      sequence: this.repository.nextTranscriptSequence(interviewId),
      speaker: "BORROWER",
      text,
      confirmation: "FINAL",
      createdAt: now,
    };
    if (!prepared) {
      this.repository.insertTranscript(acceptedTranscript, {
        ...transcriptMetadata,
        rawText: text,
      });
    }
    let plan: DeterministicTurnPlan;
    try {
      plan = prepared?.plan ?? this.turnPlanner.plan({
        text,
        currentInfoCode: stored.currentQuestionCode,
        informationItems,
        followupExhaustedInfoCodes: exhaustedFollowupCodes(
          stored.currentQuestionCode,
          informationItems,
        ),
      });
    } catch (error) {
      this.repository.insertAuditEvent(
        this.idFactory(),
        interviewId,
        "TURN_PROCESSING_FAILED",
        {
          transcriptSegmentId: acceptedTranscript.id,
          retryable: true,
          errorName: error instanceof Error ? error.name : "UnknownError",
        },
        now,
      );
      return {
        snapshot: this.getLiveSnapshot(interviewId, true),
        stateChanges: this.repository.listEventsAfter(
          interviewId,
          firstEventSequence,
        ),
        evidenceAdded: [],
        acceptedTranscript,
        processing: {
          status: "RETRYABLE_FAILURE",
          code: "TURN_PROCESSING_FAILED",
        },
      };
    }
    const evidenceAdded: EvidenceRef[] = [];

    for (const candidate of plan.extractedItems) {
      const item = this.repository.getInformationItem(interviewId, candidate.infoCode);
      const record = records.find((entry) => entry.infoCode === candidate.infoCode);
      if (!item || !record) continue;
      const transitions = plan.stateChanges.filter(
        (change) => change.infoCode === candidate.infoCode,
      );
      if (transitions.length === 0 && ["CONFIRMED", "UNAVAILABLE", "REFUSED", "NOT_APPLICABLE"].includes(item.status)) {
        continue;
      }

      const evidence: EvidenceRef = {
        id: this.idFactory(),
        interviewId,
        infoCode: candidate.infoCode,
        kind: candidate.verification,
        source: "borrower_statement",
        transcriptSegmentId: acceptedTranscript.id,
        excerpt: candidate.evidenceSpan.text,
        observedAt: now,
        metadata: {
          schemaVersion: "dev-v1",
          parserConfidence: candidate.parserConfidence,
          missingFields: candidate.missingFields,
          explanation: candidate.explanation,
        },
      };
      this.repository.insertEvidence(evidence);
      evidenceAdded.push(evidence);
      const effectiveValue = withInferredSalesChannels(candidate.value, text);
      const revision = createCanonicalValueRevision(
        {
          id: this.idFactory(),
          infoCode: candidate.infoCode,
          valueState: candidate.valueState,
          value: effectiveValue,
          quality: candidate.quality,
          parserConfidence: candidate.parserConfidence,
          verification: candidate.verification,
          evidenceIds: [evidence.id],
          observedAt: now,
          supersedesRevisionId: record.selectedRevisionId,
        },
        record.revisions,
      );
      const openConflict = this.repository.getOpenCanonicalConflict(
        principal.tenantId,
        interviewId,
        candidate.infoCode,
      );
      const previouslySelected = record.revisions.find(
        (entry) => entry.id === record.selectedRevisionId,
      );
      const conflict =
        openConflict === null && previouslySelected
          ? detectCanonicalValueConflict(
              this.idFactory(),
              previouslySelected,
              revision,
            )
          : null;
      const resolvesOpenConflict = Boolean(
        openConflict &&
          item.status === "CONFLICT" &&
          candidate.valueState === "PRESENT" &&
          candidate.value !== null &&
          candidate.proposedStatus === "CONFIRMED",
      );
      const keepsOpenConflict = Boolean(
        openConflict && item.status === "CONFLICT" && !resolvesOpenConflict,
      );
      let revisions: CanonicalValueRevision[];
      let selectedRevisionId: string | null;
      let resolvedConflictId: string | null = null;
      if (openConflict && resolvesOpenConflict) {
        const selectedReported =
          record.revisions.find(
            (entry) =>
              openConflict.candidateRevisionIds.includes(entry.id) &&
              entry.verification === "SELF_REPORTED",
          )?.id ?? openConflict.candidateRevisionIds[1];
        const resolution = resolveCanonicalConflict(
          openConflict,
          {
            type: "ACCEPT_REPORTED",
            selectedRevisionId: selectedReported,
            resolutionRevisionId: revision.id,
            evidenceIds: [evidence.id],
            reason: "후속 답변으로 동일 항목의 canonical 값을 다시 확인",
            resolvedAt: now,
          },
          [...record.revisions, revision],
        );
        revisions = resolution.revisions;
        selectedRevisionId = revision.id;
        resolvedConflictId = openConflict.id;
        this.repository.resolveCanonicalConflict(
          principal.tenantId,
          interviewId,
          resolution.conflict,
          now,
        );
      } else if (keepsOpenConflict) {
        // UNKNOWN/REFUSED/부분 답변은 어느 기존 후보도 채택하지 않는다. 새 발화와
        // revision은 감사용으로 보존하되 conflict ledger와 선택 포인터는 그대로 둔다.
        revisions = [...record.revisions, revision];
        selectedRevisionId = null;
      } else if (conflict) {
        revisions = markConflictRevisions(
          [...record.revisions, revision],
          conflict,
        );
        selectedRevisionId = null;
        this.repository.insertCanonicalConflict(
          principal.tenantId,
          interviewId,
          conflict,
          now,
        );
      } else {
        revisions = selectCanonicalRevision(
          [...record.revisions, revision],
          revision.id,
        );
        selectedRevisionId = revision.id;
      }
      const selectedRevision =
        revisions.find((entry) => entry.id === revision.id) ?? revision;
      this.repository.insertCanonicalRevision(
        principal.tenantId,
        interviewId,
        selectedRevision,
      );

      let currentItem = this.repository.getInformationItem(
        interviewId,
        candidate.infoCode,
      );
      if (openConflict && resolvesOpenConflict && currentItem?.status === "CONFLICT") {
        this.repository.transitionStatus(
          interviewId,
          candidate.infoCode,
          "ASKING",
          "후속 답변으로 canonical conflict 해소를 시작",
          this.idFactory(),
          now,
        );
        currentItem = this.repository.getInformationItem(
          interviewId,
          candidate.infoCode,
        );
      }
      const firstTransition = transitions[0];
      let remainingTransitions = transitions;
      if (
        currentItem?.status === "ASKING" &&
        (firstTransition?.to === "COLLECTED" ||
          candidate.proposedStatus === "CONFIRMED")
      ) {
        this.repository.transitionStatus(
          interviewId,
          candidate.infoCode,
          "COLLECTED",
          firstTransition?.reason ?? "canonical 값을 추출",
          this.idFactory(),
          now,
          { incidentalExtraction: firstTransition?.incidentalExtraction },
        );
        if (firstTransition?.to === "COLLECTED") {
          remainingTransitions = transitions.slice(1);
        }
      }
      this.repository.updateValue(
        interviewId,
        candidate.infoCode,
        {
          valueState: keepsOpenConflict ? item.valueState : candidate.valueState,
          value: (keepsOpenConflict ? item.value : effectiveValue) as never,
          quality: keepsOpenConflict ? item.quality : candidate.quality,
          extractionConfidence: candidate.parserConfidence,
          verification:
            conflict || keepsOpenConflict ? "CONFLICTING" : candidate.verification,
          evidenceIds: [...item.evidenceIds, evidence.id],
        },
        "dev-v1 canonical parser candidate 저장",
        this.idFactory(),
        now,
      );
      if (conflict) {
        const afterValue = this.repository.getInformationItem(
          interviewId,
          candidate.infoCode,
        );
        if (afterValue?.status !== "CONFLICT") {
          this.repository.transitionStatus(
            interviewId,
            candidate.infoCode,
            "CONFLICT",
            `prefill과 차주 진술의 canonical basis/value conflict: ${conflict.reason}`,
            this.idFactory(),
            now,
          );
        }
        this.repository.insertAuditEvent(
          this.idFactory(),
          interviewId,
          "CANONICAL_CONFLICT_OPENED",
          { tenantId: principal.tenantId, conflict },
          now,
        );
      } else if (!keepsOpenConflict) {
        for (const transition of remainingTransitions) {
          const current = this.repository.getInformationItem(
            interviewId,
            candidate.infoCode,
          );
          if (
            !current ||
            current.status === transition.to ||
            current.status !== transition.from
          ) {
            continue;
          }
          this.repository.transitionStatus(
            interviewId,
            candidate.infoCode,
            transition.to,
            transition.reason,
            this.idFactory(),
            now,
            { incidentalExtraction: transition.incidentalExtraction },
          );
        }
        const afterTransitions = this.repository.getInformationItem(
          interviewId,
          candidate.infoCode,
        );
        if (
          afterTransitions &&
          afterTransitions.status !== candidate.proposedStatus
        ) {
          this.repository.transitionStatus(
            interviewId,
            candidate.infoCode,
            candidate.proposedStatus,
            resolvedConflictId
              ? "후속 답변으로 canonical conflict 해소"
              : "canonical parser 결과 반영",
            this.idFactory(),
            now,
          );
        }
        if (resolvedConflictId) {
          this.repository.insertAuditEvent(
            this.idFactory(),
            interviewId,
            "CANONICAL_CONFLICT_RESOLVED",
            {
              tenantId: principal.tenantId,
              conflictId: resolvedConflictId,
              resolutionRevisionId: revision.id,
              resolutionType: "ACCEPT_REPORTED",
            },
            now,
          );
        }
      }
      const finalStatus =
        conflict || keepsOpenConflict ? "CONFLICT" : candidate.proposedStatus;
      const updatedRecord: CanonicalInformationRecord = {
        ...record,
        status: finalStatus,
        valueState: keepsOpenConflict ? record.valueState : candidate.valueState,
        selectedRevisionId,
        revisions,
        updatedAt: now,
      };
      this.repository.upsertCanonicalRecord(
        principal.tenantId,
        interviewId,
        aggregateVersion,
        updatedRecord,
      );
      const index = records.findIndex((entry) => entry.infoCode === updatedRecord.infoCode);
      if (index >= 0) records[index] = updatedRecord;
    }

    let updatedItems = this.repository.listInformationItems(interviewId);
    const selectionContext = questionSelectionContextAfterAnswer(
      updatedItems,
      plan.currentInfoCode,
    );
    const eligibleNextQuestions = selectEligibleNextQuestions(
      updatedItems,
      null,
      selectionContext,
      3,
    );
    let nextQuestion: NextQuestion | null = eligibleNextQuestions.find(
      (candidate) => candidate.infoCode === plan.nextQuestion?.infoCode,
    ) ?? eligibleNextQuestions[0] ?? null;
    if (nextQuestion) {
      const nextItem = updatedItems.find((item) => item.infoCode === nextQuestion?.infoCode);
      if (nextItem?.status === "NEEDED") {
        this.repository.transitionStatus(
          interviewId,
          nextItem.infoCode,
          "ASKING",
          "dev-v1 priority/dependency selector가 다음 질문을 선택",
          this.idFactory(),
          now,
        );
        const record = records.find((entry) => entry.infoCode === nextItem.infoCode);
        if (record) {
          const askingRecord = { ...record, status: "ASKING" as const, updatedAt: now };
          this.repository.upsertCanonicalRecord(
            principal.tenantId,
            interviewId,
            aggregateVersion,
            askingRecord,
          );
        }
        updatedItems = this.repository.listInformationItems(interviewId);
        nextQuestion = selectNextQuestion(updatedItems, nextItem.infoCode, selectionContext);
      }
    }
    nextQuestion = withAdaptiveQuestionText(nextQuestion, plan.nextQuestion);
    this.repository.setCurrentQuestion(interviewId, nextQuestion?.infoCode ?? null, now);
    if (nextQuestion) {
      this.repository.insertTranscript({
        id: this.idFactory(),
        interviewId,
        sequence: this.repository.nextTranscriptSequence(interviewId),
        speaker: "ASSISTANT",
        text: nextQuestion.text,
        confirmation: "FINAL",
        createdAt: now,
      });
    }
    return {
      snapshot: this.getLiveSnapshot(interviewId, true),
      stateChanges: this.repository.listEventsAfter(interviewId, firstEventSequence),
      evidenceAdded,
      acceptedTranscript,
      processing: { status: "APPLIED", code: null },
    };
  }

  private processMonthlyAverageSales(
    interviewId: string,
    item: InformationItem,
    transcript: TranscriptSegment,
    now: string,
  ): EvidenceRef {
    const extraction = parseMonthlyAverageSales(transcript.text);
    const prefillAmount = isMoneyValue(item.prefill?.value) ? item.prefill.value.amount : null;
    const conflict =
      extraction.kind === "PRESENT" &&
      prefillAmount !== null &&
      hasMaterialAmountConflict(prefillAmount, extraction.value.amount);
    const evidence: EvidenceRef = {
      id: this.idFactory(),
      interviewId,
      infoCode: item.infoCode,
      kind:
        extraction.kind === "PRESENT"
          ? conflict
            ? "CONFLICTING"
            : "SELF_REPORTED"
          : extraction.kind === "UNAVAILABLE" || extraction.kind === "AMBIGUOUS"
            ? "UNKNOWN"
            : "SELF_REPORTED",
      source: "borrower_statement",
      transcriptSegmentId: transcript.id,
      excerpt: transcript.text,
      observedAt: now,
      metadata: {
        extractionKind: extraction.kind,
        normalizedText: extraction.normalizedText,
        reportedValue: extraction.kind === "PRESENT" ? extraction.value : null,
        prefillAmount,
        materialConflict: conflict,
      },
    };
    this.repository.insertEvidence(evidence);

    if (extraction.kind === "PRESENT") {
      this.repository.transitionStatus(
        interviewId,
        item.infoCode,
        "COLLECTED",
        "월평균 매출 금액을 결정론적으로 추출",
        this.idFactory(),
        now,
      );
      this.repository.updateValue(
        interviewId,
        item.infoCode,
        {
          valueState: "PRESENT",
          value: extraction.value,
          quality: "MEDIUM",
          extractionConfidence: extraction.confidence,
          verification: conflict ? "CONFLICTING" : "SELF_REPORTED",
          evidenceIds: [...item.evidenceIds, evidence.id],
        },
        "확정 transcript에서 월평균 매출 값 저장",
        this.idFactory(),
        now,
      );
      this.repository.transitionStatus(
        interviewId,
        item.infoCode,
        conflict ? "CONFLICT" : "CONFIRMED",
        conflict
          ? "기존 카드매출 관측값과 차주 진술의 큰 차이를 탐지"
          : "추출값과 근거를 확인하여 정보 확정",
        this.idFactory(),
        now,
      );
      return evidence;
    }

    const preserveConflictingCandidate =
      item.verification === "CONFLICTING" &&
      item.valueState === "PRESENT" &&
      item.value !== null;
    this.repository.updateValue(
      interviewId,
      item.infoCode,
      {
        valueState: preserveConflictingCandidate ? item.valueState : extraction.valueState,
        value: preserveConflictingCandidate ? item.value : null,
        quality: preserveConflictingCandidate ? item.quality : null,
        extractionConfidence: extraction.confidence,
        verification: preserveConflictingCandidate ? "CONFLICTING" : evidence.kind,
        evidenceIds: [...item.evidenceIds, evidence.id],
      },
      "숫자를 생성하지 않고 응답 경계 상태 저장",
      this.idFactory(),
      now,
    );
    if (extraction.followupQuestion) {
      this.repository.updateFollowupQuestion(
        interviewId,
        item.infoCode,
        extraction.followupQuestion,
      );
    }
    this.repository.transitionStatus(
      interviewId,
      item.infoCode,
      extraction.targetStatus,
      "모호성·확인 불가·거절 응답 분류",
      this.idFactory(),
      now,
    );
    return evidence;
  }

  completeInterview(interviewId: string): CompletionResult {
    const result = this.finalizeInterview(interviewId, {
      forceIncomplete: false,
      generateEvaluation: true,
    });
    if (!result.evaluation) {
      throw new ApplicationError(500, "EVALUATION_NOT_CREATED", "평가 생성 결과가 없습니다.");
    }
    return { snapshot: result.snapshot, evaluation: result.evaluation };
  }

  completeInterviewCommand(
    interviewId: string,
    command: CompleteCommand,
    principal: Principal,
  ): CompleteCommandResult {
    const now = this.timestamp();
    const requestHash = this.commandHash(command);
    return this.repository.transaction(() => {
      const aggregate = this.platformRepository.getInterviewAggregate(
        principal.tenantId,
        interviewId,
      );
      const existingReceipt = this.platformRepository.getCommandReceipt<CompleteCommandResult>(
        principal.tenantId,
        interviewId,
        "COMPLETE",
        command.clientCommandId,
      );
      if (existingReceipt) {
        this.platformRepository.assertReceiptMatches(existingReceipt.requestHash, requestHash);
        return existingReceipt.response;
      }

      const pendingMessage = this.platformRepository.getPendingMessageCommandStage(
        principal.tenantId,
        interviewId,
      );
      if (pendingMessage) {
        throw new ApplicationError(
          409,
          "PENDING_MESSAGE_COMMAND",
          "The interview cannot be finalized while an answer is awaiting Claude processing.",
          {
            clientMessageId: pendingMessage.clientMessageId,
            processingState:
              pendingMessage.processingLeaseExpiresAt &&
              pendingMessage.processingLeaseExpiresAt > now
                ? "PROCESSING"
                : "READY",
          },
        );
      }

      if (aggregate.lifecycleStatus !== "ACTIVE") {
        const existingSnapshot = this.repository.getFinalSnapshot<StoredFinalSnapshot>(interviewId);
        if (!existingSnapshot) {
          throw new ApplicationError(
            409,
            "INTERVIEW_FINALIZED_WITHOUT_SNAPSHOT",
            "종료된 인터뷰의 FINAL snapshot을 찾을 수 없습니다.",
          );
        }
        return {
          snapshot: this.withFinalSession(
            existingSnapshot,
            aggregate.lastEventSeq,
            principal.tenantId,
          ),
          evaluation: this.findEvaluation(interviewId),
          evaluationEligibility: {
            eligible: existingSnapshot.completionStatus === "COMPLETE",
            blockers:
              existingSnapshot.completionStatus === "COMPLETE"
                ? []
                : ["INTERVIEW_FORCE_COMPLETED_INCOMPLETE"],
            mode:
              existingSnapshot.completionStatus === "COMPLETE"
                ? "COMPLETE"
                : "FORCE_INCOMPLETE",
            reason: null,
          },
          improvementSelection: this.repository.getBorrowerImprovementSelection(
            principal.tenantId,
            interviewId,
          ),
        };
      }

      if (command.mode === "FORCE_INCOMPLETE" && !command.reason?.trim()) {
        throw new ApplicationError(
          400,
          "COMPLETION_REASON_REQUIRED",
          "강제 중단에는 비어 있지 않은 reason이 필요합니다.",
        );
      }

      const resultingVersion = this.platformRepository.advanceCompletionVersion({
        tenantId: principal.tenantId,
        interviewId,
        expectedVersion: command.expectedVersion,
        now,
      });
      const live = this.enhanceLiveSnapshot(
        this.getLiveSnapshot(interviewId, true),
        principal.tenantId,
        now,
      );
      const improvementChoice = command.improvementChoice ?? null;
      if (improvementChoice !== null) {
        const allowlistedCandidates = buildAllowlistedImprovementCandidates({
          informationItems: live.informationItems.map((item) => ({
            infoCode: item.infoCode,
            status: item.status,
            updatedAt: item.updatedAt,
            evidenceIds: item.evidenceIds,
            displayValue: item.infoCode === "improvement_plan"
              ? improvementPlanCandidateDisplayValue(item.value)
              : item.status === "CONFIRMED" && item.value !== null
                ? "CONFIRMED_VALUE"
                : null,
          })),
          goal: {
            status: live.goalSnapshot.status,
            title: live.goalSnapshot.title,
            evidenceIds: live.goalSnapshot.evidenceIds,
          },
        });
        if (!isAllowlistedImprovementChoice(improvementChoice, allowlistedCandidates)) {
          throw new ApplicationError(
            422,
            "IMPROVEMENT_CHOICE_NOT_ALLOWLISTED",
            "선택한 개선 후보가 현재 인터뷰 기록에서 다시 생성한 후보와 일치하지 않습니다.",
          );
        }
      }
      const borrowerConfirmation = this.recordBorrowerConfirmation(
        interviewId,
        command.borrowerConfirmed,
        now,
      );
      const evidence = this.repository.listEvidence(interviewId);
      const activity = this.activityRegistry.snapshot(
        principal.tenantId,
        interviewId,
        now,
      );
      const assessment = assessInterviewCompletion({
        mode: command.mode === "COMPLETE" ? "STRICT" : "FORCE_INCOMPLETE",
        records: live.canonicalInformationItems,
        featureSet: live.features,
        goal: live.goalSnapshot,
        borrowerConfirmation,
        knownEvidenceIds: new Set(evidence.map((item) => item.id)),
        catalogValid:
          validateRequiredInformationCatalog(live.informationItems, {
            requireDevV1Codes: true,
          }).length === 0,
        activeTurn: activity.activeTurn,
        finalTranscriptPending: activity.finalTranscriptPending,
        unresolvedConflictInfoCodes: live.canonicalInformationItems
          .filter((record) => record.status === "CONFLICT")
          .map((record) => record.infoCode),
        forceReason: command.reason,
      });
      if (!assessment.canFinalize) {
        throw new ApplicationError(
          409,
          "COMPLETION_BLOCKED",
          "필수 완료 조건이 충족되지 않았습니다.",
          { blockers: assessment.blockers },
        );
      }
      const finalized = this.finalizeCanonicalInterview(
        interviewId,
        principal,
        live,
        assessment,
        now,
      );
      const improvementSelection = improvementChoice === null
        ? null
        : this.repository.insertBorrowerImprovementSelection({
            id: this.idFactory(),
            tenantId: principal.tenantId,
            interviewId,
            finalSnapshotId: finalized.snapshot.id,
            choice: improvementChoice,
            liveVersion: live.session.version,
            clientCommandId: command.clientCommandId,
            createdAt: now,
          });
      if (improvementSelection) {
        this.repository.insertAuditEvent(
          this.idFactory(),
          interviewId,
          BORROWER_SELECTED_IMPROVEMENT_CANDIDATE,
          {
            tenantId: principal.tenantId,
            selectionId: improvementSelection.id,
            finalSnapshotId: finalized.snapshot.id,
            choice: improvementSelection.choice,
            nonBinding: true,
            excludedFrom: ["CREDIT", "APPROVAL", "DATA_QUALITY_SCORE", "CONFIRMED_GOAL"],
          },
          now,
        );
      }
      const completionDrafts: RealtimeEventDraft[] = [];
      if (finalized.evaluation?.status === "READY") {
        completionDrafts.push({
          type: "evaluation.ready",
          snapshotType: "FINAL",
          data: {
            evaluationId: finalized.evaluation.id,
            finalSnapshotId: finalized.snapshot.id,
            snapshotVersion: finalized.snapshot.stateVersion,
            decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
          },
        });
      }
      completionDrafts.push({
        type: "interview.completed",
        snapshotType: "FINAL",
        data: {
          finalSnapshotId: finalized.snapshot.id,
          evaluationId: finalized.evaluation?.id ?? null,
          completionStatus: finalized.snapshot.completionStatus,
          evaluationEligible: assessment.evaluationEligible,
        },
      });
      const events = this.platformRepository.appendOutboxEvents({
        tenantId: principal.tenantId,
        interviewId,
        aggregateVersion: resultingVersion,
        turnId: command.clientCommandId,
        now,
        eventIdFactory: this.idFactory,
        drafts: completionDrafts,
      });
      const response: CompleteCommandResult = {
        snapshot: this.withFinalSession(
          finalized.snapshot,
          events.at(-1)?.seq ?? aggregate.lastEventSeq,
          principal.tenantId,
        ),
        evaluation: finalized.evaluation,
        evaluationEligibility: {
          eligible: assessment.evaluationEligible,
          blockers: assessment.blockers.map((blocker) =>
            blocker.entityCode ? `${blocker.code}:${blocker.entityCode}` : blocker.code,
          ),
          mode: command.mode,
          reason: command.reason,
        },
        improvementSelection,
      };
      this.platformRepository.insertCommandReceipt({
        id: this.idFactory(),
        tenantId: principal.tenantId,
        interviewId,
        commandType: "COMPLETE",
        clientCommandId: command.clientCommandId,
        requestHash,
        expectedVersion: command.expectedVersion,
        resultingVersion,
        response,
        now,
      });
      return response;
    });
  }

  getEvaluation(idOrInterviewId: string) {
    return this.repository.getEvaluation(idOrInterviewId);
  }

  getEvaluationForPrincipal(idOrInterviewId: string, principal: Principal) {
    this.platformRepository.assertEvaluationAccess(principal.tenantId, idOrInterviewId);
    return this.repository.getEvaluation<InterviewEvaluation | CanonicalEvaluationView>(
      idOrInterviewId,
    );
  }

  getInformationItemsForPrincipal(interviewId: string, principal: Principal) {
    const snapshot = this.getInterviewSnapshot(interviewId, principal);
    const items =
      "canonicalInformationItems" in snapshot
        ? snapshot.canonicalInformationItems
        : snapshot.informationItems;
    return {
      interviewId,
      snapshotType: snapshot.snapshotType,
      version: snapshot.session.version,
      informationItems: items,
    };
  }

  getFeaturesForPrincipal(interviewId: string, principal: Principal) {
    const snapshot = this.getInterviewSnapshot(interviewId, principal);
    return {
      interviewId,
      snapshotType: snapshot.snapshotType,
      version: snapshot.session.version,
      features: "features" in snapshot ? snapshot.features : null,
      improvementFeatures: "improvementFeatures" in snapshot ? snapshot.improvementFeatures : null,
      summary:
        "liveSummary" in snapshot
          ? snapshot.liveSummary
          : "borrowerSummary" in snapshot
            ? snapshot.borrowerSummary
            : null,
    };
  }

  listEvaluationSummaries(
    principal: Principal,
    query: EvaluationListQuery = {},
  ): EvaluationListResult {
    const allTenantRecords = this.platformRepository.listEvaluationRecords(principal.tenantId, { limit: 500 });
    const records = this.platformRepository.listEvaluationRecords(principal.tenantId, {
      search: query.q,
      industry: query.industry,
      level: query.level,
      from: query.from,
      to: query.to,
      limit: query.limit,
      offset: query.offset,
    });

    const items = records.map((record): EvaluationListItem => {
      const overall = objectValue(record.evaluation.overall);
      const coverage = objectValue(record.finalSnapshot.coverage);
      const grade = dataQualityGrade(overall?.grade ?? overall?.level);
      const completionStatus = overall?.completionStatus === "INCOMPLETE" ||
        record.finalSnapshot.completionStatus === "INCOMPLETE"
        ? "INCOMPLETE" as const
        : "COMPLETE" as const;
      return {
        id: record.evaluationId,
        interviewId: record.interviewId,
        status: record.status,
        createdAt: record.createdAt,
        completedAt: record.completedAt,
        borrowerName: record.borrowerName,
        businessName: record.businessName,
        industry: record.industry,
        overallScore: Math.round(finiteNumber(overall?.score ?? overall?.dataSufficiencyScore)),
        overallLevel: grade,
        overallLevelLabel: dataQualityLabel(grade),
        informationRate: percentage(
          coverage?.overallRate ?? coverage?.requiredInformationRate,
        ),
        goalCount: record.confirmedGoalCount,
        completionStatus,
        decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
      };
    });

    const allItemsForFacets = allTenantRecords.map((record) => {
      const overall = objectValue(record.evaluation.overall);
      return {
        industry: record.industry,
        overallLevel: dataQualityGrade(overall?.grade ?? overall?.level),
      };
    });

    return {
      items,
      total: items.length,
      facets: {
        industries: [...new Set(allItemsForFacets.map((item) => item.industry))].sort((a, b) =>
          a.localeCompare(b, "ko-KR"),
        ),
        levels: [...new Set(allItemsForFacets.map((item) => item.overallLevel))].sort(),
      },
    };
  }

  getEvaluationPillarsForPrincipal(idOrInterviewId: string, principal: Principal) {
    this.platformRepository.assertEvaluationAccess(principal.tenantId, idOrInterviewId);
    const evaluationRecord = this.repository.getEvaluationRecord(idOrInterviewId);
    const stored = this.repository.listEvaluationArtifacts<Record<string, unknown>>(
      principal.tenantId,
      evaluationRecord.id,
      "pillars",
    );
    const evaluation = this.repository.getEvaluation<
      InterviewEvaluation | CanonicalEvaluationView
    >(idOrInterviewId);
    return {
      evaluationId: evaluationRecord.id,
      interviewId: evaluationRecord.interviewId,
      snapshotType: "FINAL" as const,
      snapshotVersion: evaluationRecord.snapshotVersion,
      pillars: stored.length > 0 ? stored : evaluation.pillars,
    };
  }

  getEvaluationGoalsForPrincipal(idOrInterviewId: string, principal: Principal) {
    this.platformRepository.assertEvaluationAccess(principal.tenantId, idOrInterviewId);
    const evaluationRecord = this.repository.getEvaluationRecord(idOrInterviewId);
    const stored = this.repository.listEvaluationArtifacts<Record<string, unknown>>(
      principal.tenantId,
      evaluationRecord.id,
      "goals",
    );
    const snapshot = this.repository.getFinalSnapshot<StoredFinalSnapshot>(
      evaluationRecord.interviewId,
    );
    return {
      evaluationId: evaluationRecord.id,
      interviewId: evaluationRecord.interviewId,
      snapshotType: "FINAL" as const,
      snapshotVersion: evaluationRecord.snapshotVersion,
      goals:
        stored.length > 0
          ? stored
          : snapshot && "goalSnapshot" in snapshot
            ? [snapshot.goalSnapshot]
            : [],
    };
  }

  getEvaluationEvidenceForPrincipal(idOrInterviewId: string, principal: Principal) {
    this.platformRepository.assertEvaluationAccess(principal.tenantId, idOrInterviewId);
    const evaluationRecord = this.repository.getEvaluationRecord(idOrInterviewId);
    const snapshot = this.repository.getFinalSnapshot<StoredFinalSnapshot>(
      evaluationRecord.interviewId,
    );
    if (!snapshot) {
      throw new ApplicationError(
        409,
        "FINAL_SNAPSHOT_MISSING",
        "평가 근거의 FINAL snapshot을 찾을 수 없습니다.",
      );
    }
    return {
      evaluationId: evaluationRecord.id,
      interviewId: evaluationRecord.interviewId,
      snapshotType: "FINAL" as const,
      snapshotVersion: evaluationRecord.snapshotVersion,
      evidence: snapshot.evidenceManifest,
    };
  }

  reprocessTranscriptCorrection(
    context: TranscriptCorrectionReprocessingContext,
  ): TranscriptCorrectionReprocessingResult {
    if (context.database !== this.repository.database) {
      throw new ApplicationError(
        500,
        "CORRECTION_DATABASE_MISMATCH",
        "Transcript correction과 interview service의 transaction 경계가 다릅니다.",
      );
    }
    const aggregate = this.platformRepository.getInterviewAggregate(
      context.tenantId,
      context.interviewId,
    );
    if (
      aggregate.lifecycleStatus !== "ACTIVE" ||
      aggregate.version !== context.aggregateVersion
    ) {
      throw new ApplicationError(
        409,
        "CORRECTION_REPROCESSING_CONFLICT",
        "Transcript correction 재처리 중 aggregate가 변경되었습니다.",
      );
    }

    const linkedInfoCodes = context.database
      .prepare(
        `SELECT DISTINCT info_code
         FROM evidence_refs
         WHERE interview_id = ? AND transcript_segment_id = ?
         ORDER BY rowid ASC`,
      )
      .all(context.interviewId, context.segmentId)
      .map((row) => String(row.info_code));
    const stored = this.repository.getInterview(context.interviewId);
    const informationItems = this.repository.listInformationItems(context.interviewId);
    const records = this.ensureCanonicalRecords(
      context.tenantId,
      context.interviewId,
      informationItems,
      context.aggregateVersion,
      context.occurredAt,
    );
    const plan = planDeterministicInterviewTurn({
      text: context.correctedText,
      currentInfoCode: linkedInfoCodes[0] ?? stored.currentQuestionCode,
      informationItems,
      followupExhaustedInfoCodes: exhaustedFollowupCodes(
        linkedInfoCodes[0] ?? stored.currentQuestionCode,
        informationItems,
      ),
    });
    const affected = plan.extractedItems.filter(
      (candidate) =>
        linkedInfoCodes.length === 0 ||
        linkedInfoCodes.includes(candidate.infoCode),
    );
    if (affected.length === 0) {
      throw new ApplicationError(
        422,
        "CORRECTION_REPROCESSING_UNPARSEABLE",
        "수정된 transcript에서 갱신할 정보값을 추출할 수 없습니다.",
        { segmentId: context.segmentId, linkedInfoCodes },
      );
    }

    const changedInfoCodes: string[] = [];
    const resolvedConflictIds: string[] = [];
    for (const candidate of affected) {
      let item = this.repository.getInformationItem(
        context.interviewId,
        candidate.infoCode,
      );
      const record = records.find((entry) => entry.infoCode === candidate.infoCode);
      if (!item || !record) continue;
      const existingEvidenceIds = item.evidenceIds;

      const evidence: EvidenceRef = {
        id: this.idFactory(),
        interviewId: context.interviewId,
        infoCode: candidate.infoCode,
        kind: candidate.verification,
        source: "borrower_transcript_correction",
        transcriptSegmentId: context.segmentId,
        excerpt: candidate.evidenceSpan.text,
        observedAt: context.occurredAt,
        metadata: {
          schemaVersion: "dev-v1",
          correctionId: context.correctionId,
          clientCorrectionId: context.clientCorrectionId,
          transcriptRevision: context.revision,
          rawText: context.rawText,
          previousEffectiveText: context.previousEffectiveText,
          parserConfidence: candidate.parserConfidence,
          missingFields: candidate.missingFields,
          supersedesRevisionId: record.selectedRevisionId,
        },
      };
      this.repository.insertEvidence(evidence);
      const openConflict = this.repository.getOpenCanonicalConflict(
        context.tenantId,
        context.interviewId,
        candidate.infoCode,
      );
      const supersededRevisionId =
        record.selectedRevisionId ??
        record.revisions.find(
          (entry) =>
            openConflict?.candidateRevisionIds.includes(entry.id) &&
            entry.verification === "SELF_REPORTED",
        )?.id ??
        null;
      const effectiveValue = withInferredSalesChannels(
        candidate.value,
        context.correctedText,
      );
      const revision = createCanonicalValueRevision(
        {
          id: this.idFactory(),
          infoCode: candidate.infoCode,
          valueState: candidate.valueState,
          value: effectiveValue,
          quality: candidate.quality,
          parserConfidence: candidate.parserConfidence,
          verification: candidate.verification,
          evidenceIds: [evidence.id],
          observedAt: context.occurredAt,
          supersedesRevisionId: supersededRevisionId,
        },
        record.revisions,
      );
      let revisions: CanonicalValueRevision[];
      if (openConflict) {
        const selectedReported =
          record.revisions.find(
            (entry) =>
              openConflict.candidateRevisionIds.includes(entry.id) &&
              entry.verification === "SELF_REPORTED",
          )?.id ?? openConflict.candidateRevisionIds[1];
        const resolution = resolveCanonicalConflict(
          openConflict,
          {
            type: "CORRECT_TRANSCRIPT",
            selectedRevisionId: selectedReported,
            resolutionRevisionId: revision.id,
            evidenceIds: [evidence.id],
            reason: context.reason,
            resolvedAt: context.occurredAt,
          },
          [...record.revisions, revision],
        );
        revisions = resolution.revisions;
        this.repository.resolveCanonicalConflict(
          context.tenantId,
          context.interviewId,
          resolution.conflict,
          context.occurredAt,
        );
        resolvedConflictIds.push(openConflict.id);
      } else {
        revisions = selectCanonicalRevision(
          [...record.revisions, revision],
          revision.id,
        );
      }
      const selectedRevision =
        revisions.find((entry) => entry.id === revision.id) ?? revision;
      this.repository.insertCanonicalRevision(
        context.tenantId,
        context.interviewId,
        selectedRevision,
      );

      if (item.status === "CONFLICT") {
        this.repository.transitionStatus(
          context.interviewId,
          candidate.infoCode,
          "ASKING",
          "Transcript correction으로 canonical conflict 해소",
          this.idFactory(),
          context.occurredAt,
          { correction: true },
        );
        item = this.repository.getInformationItem(
          context.interviewId,
          candidate.infoCode,
        );
      } else if (
        ["CONFIRMED", "UNAVAILABLE", "REFUSED", "NOT_APPLICABLE"].includes(
          item.status,
        )
      ) {
        this.repository.transitionStatus(
          context.interviewId,
          candidate.infoCode,
          "ASKING",
          "Transcript correction으로 선택 revision을 재검증",
          this.idFactory(),
          context.occurredAt,
          { correction: true },
        );
        item = this.repository.getInformationItem(
          context.interviewId,
          candidate.infoCode,
        );
      }
      if (item?.status === "ASKING" && candidate.proposedStatus === "CONFIRMED") {
        this.repository.transitionStatus(
          context.interviewId,
          candidate.infoCode,
          "COLLECTED",
          "수정된 transcript에서 값을 재추출",
          this.idFactory(),
          context.occurredAt,
        );
      }
      this.repository.updateValue(
        context.interviewId,
        candidate.infoCode,
        {
          valueState: candidate.valueState,
          value: effectiveValue as never,
          quality: candidate.quality,
          extractionConfidence: candidate.parserConfidence,
          verification: candidate.verification,
          evidenceIds: [...new Set([...existingEvidenceIds, evidence.id])],
        },
        "수정된 transcript에서 canonical value revision 선택",
        this.idFactory(),
        context.occurredAt,
      );
      const current = this.repository.getInformationItem(
        context.interviewId,
        candidate.infoCode,
      );
      if (current && current.status !== candidate.proposedStatus) {
        this.repository.transitionStatus(
          context.interviewId,
          candidate.infoCode,
          candidate.proposedStatus,
          "수정된 transcript 재처리 결과 반영",
          this.idFactory(),
          context.occurredAt,
        );
      }
      const updatedRecord: CanonicalInformationRecord = {
        ...record,
        status: candidate.proposedStatus,
        valueState: candidate.valueState,
        selectedRevisionId: revision.id,
        revisions,
        updatedAt: context.occurredAt,
      };
      this.repository.upsertCanonicalRecord(
        context.tenantId,
        context.interviewId,
        context.aggregateVersion,
        updatedRecord,
      );
      const recordIndex = records.findIndex(
        (entry) => entry.infoCode === updatedRecord.infoCode,
      );
      if (recordIndex >= 0) records[recordIndex] = updatedRecord;
      changedInfoCodes.push(candidate.infoCode);
    }

    let updatedItems = this.repository.listInformationItems(context.interviewId);
    const currentItem = stored.currentQuestionCode
      ? updatedItems.find((item) => item.infoCode === stored.currentQuestionCode)
      : null;
    let nextQuestion = selectNextQuestion(
      updatedItems,
      currentItem && ["ASKING", "NEEDS_FOLLOWUP", "CONFLICT"].includes(currentItem.status)
        ? stored.currentQuestionCode
        : null,
    );
    if (nextQuestion) {
      const nextItem = updatedItems.find(
        (item) => item.infoCode === nextQuestion?.infoCode,
      );
      if (nextItem?.status === "NEEDED") {
        this.repository.transitionStatus(
          context.interviewId,
          nextItem.infoCode,
          "ASKING",
          "Transcript correction 재처리 후 다음 질문 선택",
          this.idFactory(),
          context.occurredAt,
        );
        const nextRecord = records.find(
          (entry) => entry.infoCode === nextItem.infoCode,
        );
        if (nextRecord) {
          const askingRecord: CanonicalInformationRecord = {
            ...nextRecord,
            status: "ASKING",
            updatedAt: context.occurredAt,
          };
          this.repository.upsertCanonicalRecord(
            context.tenantId,
            context.interviewId,
            context.aggregateVersion,
            askingRecord,
          );
          const index = records.findIndex(
            (entry) => entry.infoCode === askingRecord.infoCode,
          );
          if (index >= 0) records[index] = askingRecord;
        }
        updatedItems = this.repository.listInformationItems(context.interviewId);
        nextQuestion = selectNextQuestion(updatedItems, nextItem.infoCode);
      }
    }
    const nextQuestionCode = nextQuestion?.infoCode ?? null;
    this.repository.setCurrentQuestion(
      context.interviewId,
      nextQuestionCode,
      context.occurredAt,
    );
    if (nextQuestion && nextQuestionCode !== stored.currentQuestionCode) {
      this.repository.insertTranscript({
        id: this.idFactory(),
        interviewId: context.interviewId,
        sequence: this.repository.nextTranscriptSequence(context.interviewId),
        speaker: "ASSISTANT",
        text: nextQuestion.text,
        confirmation: "FINAL",
        createdAt: context.occurredAt,
      });
    }

    const live = this.enhanceLiveSnapshot(
      this.getLiveSnapshot(context.interviewId, true),
      context.tenantId,
      context.occurredAt,
    );
    this.repository.replaceLiveFeatures(
      context.tenantId,
      context.interviewId,
      live.features,
      context.occurredAt,
    );
    this.repository.insertAuditEvent(
      this.idFactory(),
      context.interviewId,
      "TRANSCRIPT_CORRECTION_REPROCESSED",
      {
        tenantId: context.tenantId,
        correctionId: context.correctionId,
        segmentId: context.segmentId,
        transcriptRevision: context.revision,
        changedInfoCodes,
        resolvedConflictIds,
        aggregateVersion: context.aggregateVersion,
      },
      context.occurredAt,
    );

    const outboxEvents: TranscriptCorrectionReprocessingEventDraft[] = changedInfoCodes.map((infoCode) => ({
      type: "info.value_changed" as const,
      data: {
        infoCode,
        correctionId: context.correctionId,
        transcriptRevision: context.revision,
        reprocessed: true,
      },
    }));
    for (const conflictId of resolvedConflictIds) {
      outboxEvents.push({
        type: "info.status_changed",
        data: {
          event: "CANONICAL_CONFLICT_RESOLVED",
          conflictId,
          resolutionType: "CORRECT_TRANSCRIPT",
          correctionId: context.correctionId,
        },
      });
    }
    outboxEvents.push(
      {
        type: "coverage.changed",
        data: { coverage: live.coverage, correctionId: context.correctionId },
      },
      {
        type: "feature.preview_updated",
        data: { features: live.features, correctionId: context.correctionId },
      },
      {
        type: "summary.preview_updated",
        data: { summary: live.liveSummary, correctionId: context.correctionId },
      },
    );
    if (live.nextQuestion) {
      outboxEvents.push({
        type: "question.generated",
        data: { question: live.nextQuestion, correctionId: context.correctionId },
      });
    }
    return { outboxEvents };
  }

  private recordBorrowerConfirmation(
    interviewId: string,
    confirmed: boolean,
    now: string,
  ): BorrowerFinalConfirmation {
    if (!confirmed) {
      return {
        status: "PENDING",
        confirmedAt: null,
        transcriptSegmentId: null,
        evidenceId: null,
      };
    }
    const transcript: TranscriptSegment = {
      id: this.idFactory(),
      interviewId,
      sequence: this.repository.nextTranscriptSequence(interviewId),
      speaker: "BORROWER",
      text: "화면에 제시된 최종 인터뷰 요약을 확인했습니다.",
      confirmation: "FINAL",
      createdAt: now,
    };
    this.repository.insertTranscript(transcript);
    const evidence: EvidenceRef = {
      id: this.idFactory(),
      interviewId,
      infoCode: "improvement_plan",
      kind: "SELF_REPORTED",
      source: "borrower_final_confirmation",
      transcriptSegmentId: transcript.id,
      excerpt: transcript.text,
      observedAt: now,
      metadata: { confirmationMethod: "EXPLICIT_UI_COMMAND", schemaVersion: "dev-v1" },
    };
    this.repository.insertEvidence(evidence);
    return {
      status: "CONFIRMED",
      confirmedAt: now,
      transcriptSegmentId: transcript.id,
      evidenceId: evidence.id,
    };
  }

  private finalizeCanonicalInterview(
    interviewId: string,
    principal: Principal,
    live: LivePlatformSnapshot,
    assessment: CompletionAssessment,
    finalizedAt: string,
  ): { snapshot: CanonicalFinalSnapshot; evaluation: CanonicalEvaluationView | null } {
    if (!assessment.canFinalize || !assessment.completionStatus) {
      throw new ApplicationError(
        409,
        "COMPLETION_BLOCKED",
        "완료 정책이 FINAL 생성을 허용하지 않았습니다.",
      );
    }
    const existing = this.repository.getFinalSnapshot<CanonicalFinalSnapshot>(interviewId);
    if (existing) {
      return { snapshot: existing, evaluation: this.findEvaluation(interviewId) as CanonicalEvaluationView | null };
    }
    const features = calculateLiveFeatures({
      records: live.canonicalInformationItems,
      stateVersion: live.session.version,
      snapshotType: "FINAL",
    }) as LiveFeatureSet & { snapshotType: "FINAL" };
    const summary = buildEvidenceLinkedSummary({
      records: live.canonicalInformationItems,
      features,
      version: live.session.version,
      generatedAt: finalizedAt,
      snapshotType: "FINAL",
    }) as EvidenceLinkedSummary & { snapshotType: "FINAL" };
    const finalCoverage = {
      ...calculateCoverage(live.informationItems, "FINAL"),
      snapshotType: "FINAL" as const,
    };
    const snapshotWithoutHash: Omit<CanonicalFinalSnapshot, "contentHash"> = {
      id: this.idFactory(),
      interviewId,
      snapshotType: "FINAL",
      schemaVersion: "dev-v1",
      stateVersion: live.session.version,
      version: live.session.version,
      finalizedAt,
      completionStatus: assessment.completionStatus,
      completionAssessment: assessment,
      borrower: live.borrower,
      business: live.business,
      informationItems: live.canonicalInformationItems,
      legacyInformationItems: live.informationItems,
      features,
      goalSnapshot: live.goalSnapshot,
      borrowerSummary: summary,
      transcript: this.repository.listTranscript(interviewId),
      evidenceManifest: this.repository.listEvidence(interviewId),
      coverage: finalCoverage,
      transcriptSummary: summary.plainText,
      versions: {
        valueSchema: "dev-v1",
        parser: "dev-v1",
        featureRegistry: "dev-v1",
        goalPolicy: "dev-v1",
        completionPolicy: "dev-v1",
        evaluationPolicy: "dev-v1",
      },
    };
    const contentHash = `sha256:${createHash("sha256")
      .update(JSON.stringify(snapshotWithoutHash), "utf8")
      .digest("hex")}`;
    const snapshot: CanonicalFinalSnapshot = { ...snapshotWithoutHash, contentHash };
    const validationIssues = validateImmutableFinalSnapshotV1(snapshot);
    if (validationIssues.length > 0) {
      throw new ApplicationError(
        500,
        "FINAL_SNAPSHOT_VALIDATION_FAILED",
        "FINAL snapshot 무결성 검증에 실패했습니다.",
        { issues: validationIssues },
      );
    }

    this.repository.insertFinalSnapshot(snapshot);
    let evaluation: CanonicalEvaluationView | null = null;
    if (assessment.evaluationEligible) {
      const evaluationId = this.idFactory();
      const evaluationMetadata = {
        id: evaluationId,
        interviewId,
        finalSnapshotId: snapshot.id,
        snapshotVersion: snapshot.stateVersion,
        createdAt: finalizedAt,
      };
      this.repository.insertEvaluationPayload({
        id: evaluationId,
        interviewId,
        finalSnapshotId: snapshot.id,
        snapshotVersion: snapshot.stateVersion,
        status: "PENDING",
        payload: {
          ...evaluationMetadata,
          status: "PENDING",
          decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
        },
        createdAt: finalizedAt,
      });
      this.repository.insertAuditEvent(
        this.idFactory(),
        interviewId,
        "EVALUATION_STATUS_CHANGED",
        { evaluationId, from: null, to: "PENDING" },
        finalizedAt,
      );
      this.repository.transitionEvaluationPayload({
        id: evaluationId,
        fromStatus: "PENDING",
        toStatus: "GENERATING",
        payload: {
          ...evaluationMetadata,
          status: "GENERATING",
          decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
        },
      });
      this.repository.insertAuditEvent(
        this.idFactory(),
        interviewId,
        "EVALUATION_STATUS_CHANGED",
        { evaluationId, from: "PENDING", to: "GENERATING" },
        finalizedAt,
      );

      const evaluationSavepoint = "evaluation_generation";
      this.repository.database.exec(`SAVEPOINT ${evaluationSavepoint};`);
      try {
        const evaluated = this.evaluationBuilder(snapshot);
        if (evaluated.status !== "READY") {
          throw new Error("EVALUATION_RESULT_NOT_READY");
        }
        evaluation = { ...evaluationMetadata, ...evaluated };
        const pillarIds = new Map<string, string>();
        const pillars = evaluation.pillars.map((pillar, ordinal) => {
          const id = this.idFactory();
          pillarIds.set(pillar.category, id);
          return {
            id,
            code: pillar.category,
            ordinal,
            result: pillar as unknown as Record<string, unknown>,
          };
        });
        const items = evaluation.items.map((item, ordinal) => {
          return {
            id: this.idFactory(),
            code: item.infoCode,
            ordinal,
            pillarId: pillarIds.get(item.category) ?? null,
            result: item as unknown as Record<string, unknown>,
            evidenceIds: item.evidenceIds,
          };
        });
        const goalStatus = (() => {
          if (snapshot.goalSnapshot.status === "CONFIRMED") {
            return "BORROWER_CONFIRMED" as const;
          }
          if (snapshot.goalSnapshot.origin === "BORROWER_STATED") {
            return "BORROWER_STATED" as const;
          }
          if (
            snapshot.goalSnapshot.status === "CANDIDATE" ||
            snapshot.goalSnapshot.status === "NEEDS_FOLLOWUP"
          ) {
            return "SUGGESTED" as const;
          }
          return "UNRESOLVED" as const;
        })();
        this.repository.insertEvaluationArtifacts({
          tenantId: principal.tenantId,
          interviewId,
          evaluationId,
          pillars,
          items,
          goals: [
            {
              id: this.idFactory(),
              code: "primary_improvement_goal",
              ordinal: 0,
              status: goalStatus,
              result: snapshot.goalSnapshot as unknown as Record<string, unknown>,
              evidenceIds: snapshot.goalSnapshot.evidenceIds,
            },
          ],
          createdAt: finalizedAt,
        });
        this.repository.transitionEvaluationPayload({
          id: evaluationId,
          fromStatus: "GENERATING",
          toStatus: "READY",
          payload: evaluation as unknown as Record<string, unknown>,
        });
        this.repository.database.exec(`RELEASE SAVEPOINT ${evaluationSavepoint};`);
        this.repository.insertAuditEvent(
          this.idFactory(),
          interviewId,
          "EVALUATION_STATUS_CHANGED",
          { evaluationId, from: "GENERATING", to: "READY" },
          finalizedAt,
        );
      } catch (error) {
        this.repository.database.exec(`ROLLBACK TO SAVEPOINT ${evaluationSavepoint};`);
        this.repository.database.exec(`RELEASE SAVEPOINT ${evaluationSavepoint};`);
        const failed: InterviewDataQualityEvaluationV1 = {
          policyVersion: "dev-v1",
          snapshotId: snapshot.id,
          snapshotStateVersion: snapshot.stateVersion,
          status: "FAILED",
          decisionScope: "INTERVIEW_DATA_QUALITY_ONLY",
          gradeScope: "INTERVIEW_DATA_QUALITY_GRADE_DEV_V1",
          approvalDecision: null,
          creditGrade: null,
          overall: {
            score: 0,
            grade: "UNGRADED",
            completionStatus: snapshot.completionStatus,
          },
          pillars: [],
          items: [],
          qualitySummary:
            "평가 생성에 실패해 인터뷰 데이터 품질 등급을 산출하지 않았습니다.",
          disclaimer:
            "이 결과는 대출 승인·거절 또는 공식·추정 신용등급 판단이 아닙니다.",
          failureReasons: ["EVALUATION_GENERATION_FAILED"],
        };
        evaluation = { ...evaluationMetadata, ...failed };
        this.repository.transitionEvaluationPayload({
          id: evaluationId,
          fromStatus: "GENERATING",
          toStatus: "FAILED",
          payload: evaluation as unknown as Record<string, unknown>,
        });
        this.repository.insertAuditEvent(
          this.idFactory(),
          interviewId,
          "EVALUATION_STATUS_CHANGED",
          {
            evaluationId,
            from: "GENERATING",
            to: "FAILED",
            errorName: error instanceof Error ? error.name : "UnknownError",
          },
          finalizedAt,
        );
      }
    }
    this.repository.completeInterview(
      interviewId,
      assessment.completionStatus,
      finalizedAt,
    );
    this.repository.insertAuditEvent(
      this.idFactory(),
      interviewId,
      "INTERVIEW_FINALIZED_DEV_V1",
      {
        tenantId: principal.tenantId,
        finalSnapshotId: snapshot.id,
        completionStatus: snapshot.completionStatus,
        evaluationEligible: assessment.evaluationEligible,
        contentHash,
      },
      finalizedAt,
    );
    return { snapshot, evaluation };
  }

  private finalizeInterview(
    interviewId: string,
    options: { forceIncomplete: boolean; generateEvaluation: boolean },
  ): { snapshot: FinalInterviewSnapshot; evaluation: CompletionResult["evaluation"] | null } {
    const existingSnapshot = this.repository.getFinalSnapshot(interviewId);
    if (existingSnapshot) {
      return {
        snapshot: existingSnapshot,
        evaluation: options.generateEvaluation
          ? this.repository.getEvaluation<InterviewEvaluation>(interviewId)
          : null,
      };
    }

    return this.repository.transaction(() => {
      const live = this.getLiveSnapshot(interviewId);
      if (live.session.lifecycleStatus !== "ACTIVE") {
        throw new ApplicationError(
          409,
          "INTERVIEW_FINALIZED_WITHOUT_SNAPSHOT",
          "인터뷰가 이미 종료되었지만 FINAL 스냅샷을 찾을 수 없습니다.",
        );
      }

      const finalizedAt = this.timestamp();
      const finalCoverage = {
        ...calculateCoverage(live.informationItems, "FINAL"),
        snapshotType: "FINAL" as const,
      };
      const completionStatus: "COMPLETE" | "INCOMPLETE" = options.forceIncomplete
        ? "INCOMPLETE"
        : finalCoverage.statusConfirmationRate === 1 && finalCoverage.evaluableValueRate === 1
          ? "COMPLETE"
          : "INCOMPLETE";
      const salesItem = live.informationItems.find(
        (item) => item.infoCode === "monthly_average_sales",
      );
      const salesSummary = isMoneyValue(salesItem?.value)
        ? `확인된 월평균 매출은 ${salesItem.value.amount.toLocaleString("ko-KR")}원입니다.`
        : "월평균 매출은 평가 가능한 확정값이 없습니다.";
      const snapshot: FinalInterviewSnapshot = {
        id: this.idFactory(),
        interviewId,
        snapshotType: "FINAL",
        version: live.session.version,
        finalizedAt,
        completionStatus,
        borrower: live.borrower,
        business: live.business,
        informationItems: live.informationItems,
        transcript: live.transcript,
        evidenceManifest: live.evidence,
        coverage: finalCoverage,
        transcriptSummary: `${live.borrower.name} 대표의 ${live.business.businessName} 인터뷰입니다. ${salesSummary} 필수 정보 ${finalCoverage.evaluableRequired}/${finalCoverage.totalRequired}건이 평가 가능한 상태입니다.`,
      };
      const evaluation = options.generateEvaluation
        ? buildDeterministicEvaluation(snapshot, this.idFactory())
        : null;

      this.repository.insertFinalSnapshot(snapshot);
      if (evaluation) this.repository.insertEvaluation(evaluation);
      this.repository.completeInterview(interviewId, completionStatus, finalizedAt);
      this.repository.insertAuditEvent(
        this.idFactory(),
        interviewId,
        "INTERVIEW_FINALIZED",
        {
          finalSnapshotId: snapshot.id,
          completionStatus,
          evaluationEligible: options.generateEvaluation,
          decisionScope: evaluation?.decisionScope ?? null,
        },
        finalizedAt,
      );
      return { snapshot, evaluation };
    });
  }

  private findEvaluation(
    interviewId: string,
  ): InterviewEvaluation | CanonicalEvaluationView | null {
    try {
      return this.repository.getEvaluation<InterviewEvaluation | CanonicalEvaluationView>(
        interviewId,
      );
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "EVALUATION_NOT_FOUND") return null;
      throw error;
    }
  }

  private completionBlockers(
    live: LiveInterviewSnapshot,
    borrowerConfirmed: boolean,
  ): string[] {
    const blockers: string[] = [];
    if (!borrowerConfirmed) blockers.push("BORROWER_CONFIRMATION_REQUIRED");
    if (live.coverage.statusConfirmationRate !== 1) blockers.push("REQUIRED_STATUS_INCOMPLETE");
    if (live.coverage.evaluableValueRate !== 1) blockers.push("REQUIRED_VALUE_NOT_EVALUABLE");
    for (const item of live.informationItems.filter((candidate) => candidate.status === "CONFLICT")) {
      blockers.push(`UNRESOLVED_CONFLICT:${item.infoCode}`);
    }
    return blockers;
  }

  private ensureCanonicalRecords(
    tenantId: string,
    interviewId: string,
    items: InformationItem[],
    aggregateVersion: number,
    now: string,
  ): CanonicalInformationRecord[] {
    const records = this.repository.listCanonicalRecords(tenantId, interviewId);
    for (const item of items) {
      if (records.some((record) => record.infoCode === item.infoCode)) continue;
      const record: CanonicalInformationRecord = {
        infoCode: item.infoCode,
        category: item.category,
        required: item.required,
        priority: item.priority,
        minQuality: item.minQuality,
        status: item.status,
        valueState: item.valueState,
        selectedRevisionId: null,
        revisions: [],
        updatedAt: item.updatedAt || now,
      };
      this.repository.upsertCanonicalRecord(
        tenantId,
        interviewId,
        aggregateVersion,
        record,
      );
      records.push(record);
    }
    return records;
  }

  private enhanceLiveSnapshot(
    snapshot: LiveInterviewSnapshot,
    tenantId: string,
    generatedAt: string,
  ): LivePlatformSnapshot {
    const persisted = this.repository.listCanonicalRecords(tenantId, snapshot.session.id);
    const records = snapshot.informationItems.map(
      (item) =>
        persisted.find((record) => record.infoCode === item.infoCode) ?? {
          infoCode: item.infoCode,
          category: item.category,
          required: item.required,
          priority: item.priority,
          minQuality: item.minQuality,
          status: item.status,
          valueState: item.valueState,
          selectedRevisionId: null,
          revisions: [],
          updatedAt: item.updatedAt,
        },
    );
    const features = calculateLiveFeatures({
      records,
      stateVersion: snapshot.session.version,
      snapshotType: "PREVIEW",
    }) as LiveFeatureSet & { snapshotType: "PREVIEW" };
    const improvementFeatures = buildInterviewFeatureV2(records, {
      enabled: isFeatureV2Enabled(),
    });
    const liveSummary = buildEvidenceLinkedSummary({
      records,
      features,
      version: snapshot.session.version,
      generatedAt,
      snapshotType: "PREVIEW",
    }) as EvidenceLinkedSummary & { snapshotType: "PREVIEW" };
    return {
      ...snapshot,
      snapshotType: "PREVIEW",
      canonicalInformationItems: records,
      features,
      improvementFeatures,
      liveSummary,
      goalSnapshot: extractGoalSnapshot(records),
      pendingCommand: null,
    };
  }

  private withDurablePendingCommand(
    snapshot: LivePlatformSnapshot,
    tenantId: string,
  ): LivePlatformSnapshot {
    const stage = this.platformRepository.getPendingMessageCommandStage(
      tenantId,
      snapshot.session.id,
    );
    if (!stage) return { ...snapshot, pendingCommand: null };
    const transcript = this.getStagedTranscript(
      snapshot.session.id,
      stage.transcriptSegmentId,
    );
    return {
      ...snapshot,
      pendingCommand: {
        clientMessageId: stage.clientMessageId,
        text: transcript.text,
        expectedVersion: stage.expectedVersion,
        currentQuestionInfoCode: stage.currentQuestionCode,
        transcriptMetadata: stage.transcriptMetadata,
        processingState:
          stage.processingLeaseExpiresAt &&
          stage.processingLeaseExpiresAt > this.timestamp()
            ? "PROCESSING"
            : "READY",
      },
    };
  }

  private messageEventDrafts(
    processed: Omit<MessageProcessingResult, "snapshot"> & { snapshot: LivePlatformSnapshot },
    tenantId: string,
  ): RealtimeEventDraft[] {
    const drafts: RealtimeEventDraft[] = [
      {
        type: "transcript.finalized",
        snapshotType: "PREVIEW",
        data: {
          segment: processed.acceptedTranscript,
          processing: processed.processing,
        },
      },
    ];
    const stateChangeDrafts: RealtimeEventDraft[] = processed.stateChanges.map((change) => {
      const item = processed.snapshot.informationItems.find(
        (candidate) => candidate.infoCode === change.infoCode,
      );
      return {
        type:
          change.eventType === "VALUE_CHANGED"
            ? "info.value_changed"
            : "info.status_changed",
        snapshotType: "PREVIEW",
        data: {
          change,
          item: item ?? null,
          resolution:
            change.reason.includes("canonical conflict 해소")
              ? { type: "ACCEPT_REPORTED", resolved: true }
              : null,
        },
      };
    });
    drafts.push(...stateChangeDrafts);
    drafts.push({
      type: "coverage.changed",
      snapshotType: "PREVIEW",
      data: { coverage: processed.snapshot.coverage },
    });
    drafts.push({
      type: "feature.preview_updated",
      snapshotType: "PREVIEW",
      data: { features: processed.snapshot.features },
    });
    drafts.push({
      type: "summary.preview_updated",
      snapshotType: "PREVIEW",
      data: { summary: processed.snapshot.liveSummary },
    });
    const conflicts = processed.snapshot.informationItems.filter(
      (item) => item.status === "CONFLICT",
    );
    for (const conflict of conflicts) {
      drafts.push({
        type: "conflict.detected",
        snapshotType: "PREVIEW",
        data: {
          infoCode: conflict.infoCode,
          item: conflict,
          conflict: this.repository.getOpenCanonicalConflict(
            tenantId,
            processed.snapshot.session.id,
            conflict.infoCode,
          ),
        },
      });
    }
    if (processed.snapshot.nextQuestion) {
      drafts.push({
        type: "question.generated",
        snapshotType: "PREVIEW",
        data: { question: processed.snapshot.nextQuestion },
      });
    }
    if (
      processed.snapshot.nextQuestion === null &&
      processed.snapshot.coverage.statusConfirmationRate === 1 &&
      processed.snapshot.coverage.evaluableValueRate === 1
    ) {
      drafts.push({
        type: "ready_to_complete",
        snapshotType: "PREVIEW",
        data: { coverage: processed.snapshot.coverage },
      });
    }
    return drafts;
  }

  private withLiveEventSequence(
    snapshot: LivePlatformSnapshot,
    lastEventSeq: number,
  ): LiveSnapshotWithEventSequence {
    return {
      ...snapshot,
      snapshotType: "PREVIEW",
      session: { ...snapshot.session, lastEventSeq },
    };
  }

  private withFinalSession(
    snapshot: StoredFinalSnapshot,
    lastEventSeq: number,
    tenantId: string,
  ): FinalSnapshotApiView {
    const stored = this.repository.getInterview(snapshot.interviewId);
    const canonicalItems = snapshot.informationItems.filter(
      (item): item is CanonicalInformationRecord =>
        "revisions" in item && Array.isArray(item.revisions) && "selectedRevisionId" in item,
    );
    return {
      ...snapshot,
      evaluationId: this.platformRepository.findEvaluationIdForInterview(
        tenantId,
        snapshot.interviewId,
      ),
      improvementFeatures:
        canonicalItems.length === snapshot.informationItems.length
          ? buildInterviewFeatureV2(canonicalItems, { enabled: isFeatureV2Enabled() })
          : null,
      session: {
        id: snapshot.interviewId,
        lifecycleStatus: snapshot.completionStatus,
        snapshotType: "FINAL",
        version: snapshot.version,
        createdAt: stored.session.createdAt,
        updatedAt: stored.session.updatedAt,
        completedAt: stored.session.completedAt ?? snapshot.finalizedAt,
        lastEventSeq,
      },
    };
  }

  private commandHash(command: MessageCommand | CompleteCommand): string {
    const canonical = Object.fromEntries(
      Object.entries(command).sort(([left], [right]) => left.localeCompare(right)),
    );
    return createHash("sha256").update(JSON.stringify(canonical), "utf8").digest("hex");
  }

  private timestamp(): string {
    return this.now().toISOString();
  }
}
