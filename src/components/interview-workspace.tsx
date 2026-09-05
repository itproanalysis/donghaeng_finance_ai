"use client";

import {
  AlertTriangle,
  ArrowRight,
  BriefcaseBusiness,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  FileQuestion,
  Flag,
  House,
  Info,
  Landmark,
  LoaderCircle,
  MessageSquareText,
  PencilLine,
  RefreshCw,
  Send,
  Target,
  TrendingUp,
  UserRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  adaptInterviewSnapshot,
  ApiRequestError,
  authenticatedFetch,
  createClientCommandId,
  diffInformationItemSnapshots,
  diffLiveFeatureSnapshots,
  type EvidenceView,
  extractMessageProcessingTelemetry,
  extractEvaluationId,
  formatDateTime,
  formatPercent,
  type InterviewSnapshotView,
  type InformationBucketKey,
  type InformationItemPreviewChangeView,
  type InformationItemView,
  type LiveFeatureView,
  type LiveFeaturePreviewChangeView,
  type MessageProcessingTelemetryView,
  type PendingMessageCommandView,
  type PillarKey,
  type TranscriptView,
  readApiEnvelope,
  shouldClearPendingMessageRetry,
} from "@/components/api-adapter";
import {
  AudioInterviewControls,
  type AudioInterviewStatus,
} from "@/components/audio-interview-controls";
import {
  LiveRealtimeStatus,
  type LiveSaveState,
} from "@/components/live-realtime-status";
import { ADMIN_JOURNEY, JourneyNav } from "@/components/journey-nav";
import { FinalInterviewRecord } from "@/components/final-interview-record";
import {
  comparePillarCoverageSnapshots,
  PillarCoveragePreview,
  type PillarCoveragePreviewChange,
} from "@/components/pillar-coverage-preview";
import { ErrorState, LoadingState } from "@/components/request-state";
import type { LiveInterviewSnapshot } from "@/domain";
import {
  INITIAL_INTERVIEW_LIVE_STATE,
  interviewLiveReducer,
  type LiveEventEnvelope,
} from "@/realtime/live-store";
import { useInterviewEvents } from "@/realtime/use-interview-events";
import { goalStatusLabel, questionReasonLabel, readableInformationText } from "./operator-language";

interface InterviewWorkspaceProps {
  interviewId: string;
  initialPresentationMode?: boolean;
}

type PendingClaudeRetryCommand = PendingMessageCommandView;

function reducerLiveSnapshot(value: unknown): LiveInterviewSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const root = value as Record<string, unknown>;
  const candidate =
    root.snapshot && typeof root.snapshot === "object" && !Array.isArray(root.snapshot)
      ? (root.snapshot as Record<string, unknown>)
      : root;
  const session =
    candidate.session &&
    typeof candidate.session === "object" &&
    !Array.isArray(candidate.session)
      ? (candidate.session as Record<string, unknown>)
      : null;
  if (
    session?.snapshotType !== "PREVIEW" ||
    !Array.isArray(candidate.informationItems) ||
    !Array.isArray(candidate.transcript) ||
    !Array.isArray(candidate.evidence)
  ) {
    return null;
  }
  return candidate as unknown as LiveInterviewSnapshot;
}

const pillarIcons = {
  CURRENT_STATE: Landmark,
  FUTURE_OUTLOOK: TrendingUp,
  IMPROVEMENT_INTENT: Target,
  HOUSEHOLD_STATE: House,
} satisfies Record<PillarKey, typeof Landmark>;

const bucketMeta: Record<
  InformationBucketKey,
  { label: string; description: string; icon: typeof CheckCircle2 }
> = {
  completed: {
    label: "수집 완료",
    description: "확인된 정보",
    icon: CheckCircle2,
  },
  needed: {
    label: "수집 필요",
    description: "답변이 필요한 정보",
    icon: FileQuestion,
  },
  followUp: {
    label: "추가 확인",
    description: "상태 확인이 필요한 정보",
    icon: CircleHelp,
  },
  conflict: {
    label: "정보 충돌",
    description: "상충 답변 검토 필요",
    icon: AlertTriangle,
  },
  terminal: {
    label: "별도 종결",
    description: "확인 불가·거절·해당 없음",
    icon: CircleHelp,
  },
};

function transcriptTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function ProgressBar({
  value,
  label,
}: {
  value: number | null;
  label: string;
}) {
  return (
    <div
      className="progress-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value)}
      aria-valuetext={value === null ? "아직 집계되지 않음" : formatPercent(value)}
    >
      <span style={{ width: value === null ? "0%" : `${value}%` }} />
    </div>
  );
}

function InformationCard({
  item,
  evidence,
  recent,
}: {
  item: InformationItemView;
  evidence: EvidenceView[];
  recent?: boolean;
}) {
  const sources = [
    ...new Set(
      item.evidenceIds
        .map((evidenceId) => evidence.find((entry) => entry.id === evidenceId)?.source)
        .filter((source): source is string => Boolean(source)),
    ),
  ];
  return (
    <article
      className="information-card"
      data-state={item.status.toLowerCase()}
      data-recent={recent ? "true" : undefined}
    >
      <div className="information-card__heading">
        <strong>{item.label}</strong>
        <span className="state-label" data-state={item.status.toLowerCase()}>
          {item.statusLabel}
        </span>
      </div>
      {item.displayValue !== null && (
        <p className="information-card__value">{item.displayValue}</p>
      )}
      <div className="information-card__meta">
        <span>{item.categoryLabel}</span>
        <span>{item.valueStateLabel}</span>
        {item.verificationLabel && <span>{item.verificationLabel}</span>}
      </div>
      <div className="information-card__audit">
        <span>출처 {sources.length > 0 ? sources.join(", ") : "아직 없음"}</span>
        <span>
          최근 변경 {item.updatedAt ? formatDateTime(item.updatedAt) : "아직 없음"}
        </span>
      </div>
      <details className="information-card__details">
        <summary>상세 보기</summary>
        <dl>
          <div>
            <dt>정보 코드</dt>
            <dd>{item.infoCode}</dd>
          </div>
          <div>
            <dt>우선순위</dt>
            <dd>{item.priority}</dd>
          </div>
          <div>
            <dt>완료조건</dt>
            <dd>{item.required ? "필수" : "추가"}</dd>
          </div>
          <div>
            <dt>품질</dt>
            <dd>{item.quality ?? "미확인"}</dd>
          </div>
          <div>
            <dt>연결 근거</dt>
            <dd>{item.evidenceIds.length}개</dd>
          </div>
        </dl>
      </details>
    </article>
  );
}

function StatusBucket({
  bucketKey,
  items,
  evidence,
  recentInfoCodes,
}: {
  bucketKey: InformationBucketKey;
  items: InformationItemView[];
  evidence: EvidenceView[];
  recentInfoCodes: ReadonlySet<string>;
}) {
  const meta = bucketMeta[bucketKey];
  const Icon = meta.icon;
  const shouldOpen =
    bucketKey === "needed" ||
    bucketKey === "conflict" ||
    ((bucketKey === "completed" || bucketKey === "followUp" || bucketKey === "terminal") && items.length > 0);

  return (
    <details className="status-bucket" open={shouldOpen}>
      <summary>
        <span className="status-bucket__title">
          <span className={`status-bucket__icon status-bucket__icon--${bucketKey}`}>
            <Icon size={16} aria-hidden="true" />
          </span>
          <span>
            <strong>{meta.label}</strong>
            <small>{meta.description}</small>
          </span>
        </span>
        <span className="status-bucket__count">{items.length}</span>
        <ChevronDown className="status-bucket__chevron" size={16} aria-hidden="true" />
      </summary>
      <div className="status-bucket__items">
        {items.length > 0 ? (
          items.map((item) => (
            <InformationCard
              evidence={evidence}
              item={item}
              key={item.id}
              recent={recentInfoCodes.has(item.infoCode)}
            />
          ))
        ) : (
          <p className="status-bucket__empty">해당 상태의 정보가 없습니다.</p>
        )}
      </div>
    </details>
  );
}

const featureStateLabels: Record<string, string> = {
  COMPUTED: "계산됨",
  MISSING: "입력 부족",
  UNKNOWN: "확인 불가",
  REFUSED: "응답 거절",
  NOT_APPLICABLE: "해당 없음",
  CONFLICTING: "정보 충돌",
  NOT_CALCULABLE: "계산 불가",
};

function LiveFeaturePanel({
  features,
  changes,
  registryVersion,
  stateVersion,
}: {
  features: LiveFeatureView[];
  changes: LiveFeaturePreviewChangeView[];
  registryVersion: string | null;
  stateVersion: number | null;
}) {
  const computed = features.filter((feature) => feature.state === "COMPUTED");
  const unavailable = features.filter((feature) => feature.state !== "COMPUTED");

  return (
    <article className="live-feature-card">
      <div className="insight-heading">
        <div>
          <p className="panel-kicker">계산 지표</p>
          <h2>서버 계산 PREVIEW 피쳐</h2>
        </div>
        <span className="badge badge--preview">PREVIEW</span>
      </div>
      <div className="live-feature-card__meta">
        <span>계산됨 {computed.length}</span>
        <span>미계산 {unavailable.length}</span>
        <span>registry {registryVersion ?? "미확인"}</span>
        <span>state v{stateVersion ?? "-"}</span>
      </div>
      {changes.length > 0 && (
        <section className="live-feature-changes" aria-label="직전 서버 snapshot 대비 피쳐 변화">
          <strong>이번 턴 데이터 품질 PREVIEW 변화</strong>
          <div>
            {changes.map((change) => (
              <span key={change.name}>
                <b>{change.name}</b>
                {change.previousRaw ?? featureStateLabels[change.previousState] ?? change.previousState}
                <ArrowRight size={12} aria-hidden="true" />
                {change.currentRaw ?? featureStateLabels[change.currentState] ?? change.currentState}
              </span>
            ))}
          </div>
          <p>사업·신용 점수가 아니라 서버가 계산한 피쳐의 직전 값과 현재 값입니다.</p>
        </section>
      )}
      {computed.length > 0 ? (
        <div className="live-feature-list">
          {computed.map((feature) => (
            <section className="live-feature-item" key={feature.name}>
              <div className="live-feature-item__heading">
                <strong>{feature.name}</strong>
                <span>{featureStateLabels[feature.state] ?? feature.state}</span>
              </div>
              <p className="live-feature-item__value">
                {feature.raw ?? "표시 가능한 원천값 없음"}
                {feature.normalized !== null && (
                  <small>normalized {feature.normalized}</small>
                )}
              </p>
              <p>{feature.reason ?? "서버 설명이 없습니다."}</p>
              <dl>
                <div>
                  <dt>입력</dt>
                  <dd>
                    {feature.sourceInfoCodes.length > 0
                      ? feature.sourceInfoCodes.join(", ")
                      : "없음"}
                  </dd>
                </div>
                <div>
                  <dt>산식</dt>
                  <dd>{feature.formula ?? "직접 관측"}</dd>
                </div>
                <div>
                  <dt>근거</dt>
                  <dd>{feature.evidenceIds.length}개</dd>
                </div>
              </dl>
            </section>
          ))}
        </div>
      ) : (
        <div className="summary-empty">
          <div>
            <strong>아직 계산 가능한 피쳐가 없습니다.</strong>
            <p>필요한 원천정보가 확인되면 같은 서버 snapshot에서 갱신됩니다.</p>
          </div>
        </div>
      )}
      {unavailable.length > 0 && (
        <details className="live-feature-missing">
          <summary>미계산 피쳐 {unavailable.length}개와 사유 보기</summary>
          <ul>
            {unavailable.map((feature) => (
              <li key={feature.name}>
                <strong>{feature.name}</strong>
                <span>{featureStateLabels[feature.state] ?? feature.state}</span>
                <p>{feature.reason ?? "서버 사유가 없습니다."}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="summary-footnote">
        <Info size={15} aria-hidden="true" />
        서버 snapshot을 그대로 표시하며 브라우저에서 계산하거나 공식 평가로 승격하지
        않습니다.
      </div>
    </article>
  );
}

export function InterviewWorkspace({
  interviewId,
  initialPresentationMode = false,
}: InterviewWorkspaceProps) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<InterviewSnapshotView | null>(null);
  const [featureChanges, setFeatureChanges] = useState<LiveFeaturePreviewChangeView[]>([]);
  const [informationChanges, setInformationChanges] = useState<
    InformationItemPreviewChangeView[]
  >([]);
  const [pillarCoverageChanges, setPillarCoverageChanges] = useState<
    PillarCoveragePreviewChange[]
  >([]);
  const [liveState, dispatchLive] = useReducer(
    interviewLiveReducer,
    INITIAL_INTERVIEW_LIVE_STATE,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);
  const [audioBusy, setAudioBusy] = useState(false);
  const [saveState, setSaveState] = useState<LiveSaveState>("LOADING");
  const [presentationMode, setPresentationMode] = useState(initialPresentationMode);
  const [recentEventTypes, setRecentEventTypes] = useState<
    LiveEventEnvelope["type"][]
  >([]);
  const [lastMessageProcessing, setLastMessageProcessing] = useState<
    MessageProcessingTelemetryView | null
  >(null);
  const [pendingClaudeRetry, setPendingClaudeRetry] = useState<
    PendingClaudeRetryCommand | null
  >(null);
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [correctionTarget, setCorrectionTarget] = useState<TranscriptView | null>(null);
  const [correctionText, setCorrectionText] = useState("");
  const [correctionReason, setCorrectionReason] = useState("");
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [completionBlockers, setCompletionBlockers] = useState<string[]>([]);
  const [completionOpen, setCompletionOpen] = useState(false);
  const [cloudConsentOpen, setCloudConsentOpen] = useState(false);
  const [cloudConsentSubmitting, setCloudConsentSubmitting] = useState(false);
  const [pendingCloudCommand, setPendingCloudCommand] = useState<
    PendingClaudeRetryCommand | null
  >(null);
  const [borrowerConfirmed, setBorrowerConfirmed] = useState(false);
  const [borrowerConfirmationVersion, setBorrowerConfirmationVersion] = useState<number | null>(null);
  const [forceReason, setForceReason] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const completionTriggerRef = useRef<HTMLButtonElement>(null);
  const completionDialogRef = useRef<HTMLElement>(null);
  const correctionDialogRef = useRef<HTMLElement>(null);
  const cloudConsentDialogRef = useRef<HTMLElement>(null);
  const correctionReturnFocusRef = useRef<HTMLElement | null>(null);
  const isCompletingRef = useRef(false);
  const isCorrectingRef = useRef(false);
  const resyncPromiseRef = useRef<Promise<number> | null>(null);
  const acceptedSnapshotRef = useRef<InterviewSnapshotView | null>(null);
  const lastMessageProcessingRef = useRef<MessageProcessingTelemetryView | null>(null);
  const durablePendingNoticeRef = useRef(false);
  const transcriptCount =
    snapshot?.snapshotType === "PREVIEW" ? snapshot.transcript.length : 0;
  const borrowerConfirmationCurrent =
    borrowerConfirmed && borrowerConfirmationVersion === snapshot?.version;

  const recordMessageProcessing = useCallback(
    (processing: MessageProcessingTelemetryView | null) => {
      lastMessageProcessingRef.current = processing;
      setLastMessageProcessing(processing);
    },
    [],
  );

  const acceptSnapshot = useCallback((nextSnapshot: InterviewSnapshotView) => {
    const current = acceptedSnapshotRef.current;
    if (current) {
      if (current.snapshotType === "FINAL" && nextSnapshot.snapshotType !== "FINAL") return;
      if (nextSnapshot.version < current.version) return;
      if (
        nextSnapshot.version === current.version &&
        current.snapshotType === "FINAL" &&
        nextSnapshot.snapshotType === "FINAL"
      ) {
        return;
      }
      if (
        current.snapshotType === "PREVIEW" &&
        nextSnapshot.snapshotType === "PREVIEW" &&
        nextSnapshot.version > current.version
      ) {
        setInformationChanges(
          diffInformationItemSnapshots(
            current.informationItems,
            nextSnapshot.informationItems,
          ),
        );
        setFeatureChanges(diffLiveFeatureSnapshots(current.features, nextSnapshot.features));
        setPillarCoverageChanges(
          comparePillarCoverageSnapshots(current.pillars, nextSnapshot.pillars),
        );
      }
    }
    acceptedSnapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    const durablePending =
      nextSnapshot.snapshotType === "PREVIEW"
        ? nextSnapshot.pendingCommand
        : null;
    setPendingClaudeRetry(durablePending);
    if (durablePending) {
      durablePendingNoticeRef.current = true;
      setActionError(
        durablePending.processingState === "PROCESSING"
          ? "저장된 답변을 다른 요청에서 Claude가 처리 중입니다. 잠시 후 상태를 확인하거나 같은 요청으로 다시 확인할 수 있습니다."
          : "답변은 서버에 보존되어 있습니다. 같은 요청으로 Claude 분석을 다시 시도할 수 있습니다.",
      );
    } else if (durablePendingNoticeRef.current) {
      durablePendingNoticeRef.current = false;
      setActionError(null);
    }
  }, []);

  const fetchInterview = useCallback(async () => {
    const response = await authenticatedFetch(
      `/api/interviews/${encodeURIComponent(interviewId)}`,
      { cache: "no-store" },
    );
    const data = await readApiEnvelope(response);
    return {
      view: adaptInterviewSnapshot(data),
      liveSnapshot: reducerLiveSnapshot(data),
    };
  }, [interviewId]);

  const loadInterview = useCallback(async () => {
    setIsLoading(true);
    setSaveState("SYNCING");
    setLoadError(null);
    try {
      const fetched = await fetchInterview();
      const nextSnapshot = fetched.view;
      acceptSnapshot(nextSnapshot);
      dispatchLive(
        fetched.liveSnapshot
          ? {
              type: "resync.completed",
              snapshot: fetched.liveSnapshot,
              lastEventSeq: nextSnapshot.lastEventSeq,
            }
          : {
              type: "resync.version_completed",
              version: nextSnapshot.version,
              lastEventSeq: nextSnapshot.lastEventSeq,
            },
      );
      setSaveState(
        (nextSnapshot.snapshotType === "PREVIEW" && nextSnapshot.pendingCommand) ||
        lastMessageProcessingRef.current?.status === "RETRYABLE_FAILURE"
          ? "ERROR"
          : "SAVED",
      );
    } catch (caught) {
      setSaveState("ERROR");
      setLoadError(
        caught instanceof Error
          ? caught.message
          : "인터뷰 상태를 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [acceptSnapshot, fetchInterview]);

  useEffect(() => {
    let active = true;

    fetchInterview()
      .then((fetched) => {
        if (active) {
          const nextSnapshot = fetched.view;
          acceptSnapshot(nextSnapshot);
          dispatchLive(
            fetched.liveSnapshot
              ? {
                  type: "snapshot.hydrated",
                  snapshot: fetched.liveSnapshot,
                  lastEventSeq: nextSnapshot.lastEventSeq,
                }
              : {
                  type: "snapshot.version_hydrated",
                  version: nextSnapshot.version,
                  lastEventSeq: nextSnapshot.lastEventSeq,
                },
          );
          setSaveState(
            (nextSnapshot.snapshotType === "PREVIEW" && nextSnapshot.pendingCommand) ||
            lastMessageProcessingRef.current?.status === "RETRYABLE_FAILURE"
              ? "ERROR"
              : "SAVED",
          );
        }
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setSaveState("ERROR");
        setLoadError(
          caught instanceof Error
            ? caught.message
            : "인터뷰 상태를 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [acceptSnapshot, fetchInterview]);

  const handleLiveEvent = useCallback(
    (event: LiveEventEnvelope) => {
      setSaveState("SYNCING");
      if (event.type === "transcript.finalized") {
        const processing = extractMessageProcessingTelemetry(event.data);
        recordMessageProcessing(processing);
        if (processing?.status === "RETRYABLE_FAILURE") {
          setActionError(
            "답변 전사는 서버에 보존됐지만 Claude 분석에 실패했습니다. 같은 답변을 새 메시지로 다시 보내지 말고 ‘Claude 분석 다시 시도’를 사용하세요.",
          );
        } else if (processing?.status === "NON_RETRYABLE_FAILURE") {
          setPendingClaudeRetry(null);
          setActionError(
            "답변은 안전하게 저장했지만 Claude 응답을 적용할 수 없습니다. 재시도하지 않고 운영자 확인이 필요합니다.",
          );
        }
      }
      setRecentEventTypes((current) => {
        const next = event.batchIndex === 0 ? [event.type] : [...current, event.type];
        return next.slice(-8);
      });
      dispatchLive({ type: "server.event_received", event });
    },
    [recordMessageProcessing],
  );

  const resyncLiveSnapshot = useCallback((): Promise<number> => {
    if (resyncPromiseRef.current) return resyncPromiseRef.current;
    const pending = (async () => {
      setSaveState("SYNCING");
      try {
        const fetched = await fetchInterview();
        const nextSnapshot = fetched.view;
        acceptSnapshot(nextSnapshot);
        dispatchLive(
          fetched.liveSnapshot
            ? {
                type: "resync.completed",
                snapshot: fetched.liveSnapshot,
                lastEventSeq: nextSnapshot.lastEventSeq,
              }
            : {
                type: "resync.version_completed",
                version: nextSnapshot.version,
                lastEventSeq: nextSnapshot.lastEventSeq,
              },
        );
        setSaveState(
          (nextSnapshot.snapshotType === "PREVIEW" && nextSnapshot.pendingCommand) ||
          lastMessageProcessingRef.current?.status === "RETRYABLE_FAILURE"
            ? "ERROR"
            : "SAVED",
        );
        return nextSnapshot.lastEventSeq;
      } catch (caught) {
        setSaveState("ERROR");
        setActionError(
          caught instanceof Error
            ? `실시간 상태 재동기화 실패: ${caught.message}`
            : "실시간 상태를 다시 불러오지 못했습니다.",
        );
        throw caught;
      }
    })();
    resyncPromiseRef.current = pending;
    void pending.finally(() => {
      if (resyncPromiseRef.current === pending) resyncPromiseRef.current = null;
    }).catch(() => undefined);
    return pending;
  }, [acceptSnapshot, fetchInterview]);

  const handleCommittedBatch = useCallback(async () => {
    await resyncLiveSnapshot();
  }, [resyncLiveSnapshot]);

  useInterviewEvents({
    interviewId,
    afterSeq: snapshot?.lastEventSeq ?? 0,
    enabled: snapshot?.snapshotType === "PREVIEW" && snapshot.lifecycleStatus === "ACTIVE",
    onEvent: handleLiveEvent,
    onBatchCommitted: handleCommittedBatch,
    onResyncRequired: resyncLiveSnapshot,
    onConnectionChange: (connection) =>
      dispatchLive({ type: "sse.connection_changed", connection }),
    onError: (message) => setActionError(`실시간 이벤트 오류: ${message}`),
  });

  useEffect(() => {
    if (!liveState.needsResync || resyncPromiseRef.current) return;
    void resyncLiveSnapshot();
  }, [liveState.needsResync, resyncLiveSnapshot]);

  const handleAudioStatus = useCallback((status: AudioInterviewStatus) => {
    dispatchLive({
      type: "audio.state_changed",
      patch: {
        uxState: status.uxState,
        connection: status.connection,
        providerLabel: status.providerLabel,
      },
    });
  }, []);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [transcriptCount]);

  useEffect(() => {
    isCompletingRef.current = isCompleting;
  }, [isCompleting]);

  useEffect(() => {
    isCorrectingRef.current = isCorrecting;
  }, [isCorrecting]);

  useEffect(() => {
    if (!completionOpen) return;
    const dialog = completionDialogRef.current;
    if (!dialog) return;
    const returnFocusTarget = completionTriggerRef.current;
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".app-header, .workspace-heading, .action-alert, .interview-grid, .live-insight-grid, .decision-boundary-note",
      ),
    );
    for (const element of background) element.inert = true;
    const focusableSelector =
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';
    const focusFrame = requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>(focusableSelector)?.focus();
    });
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !isCompletingRef.current) {
        event.preventDefault();
        setCompletionOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1) ?? first;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      for (const element of background) element.inert = false;
      returnFocusTarget?.focus();
    };
  }, [completionOpen]);

  useEffect(() => {
    if (!correctionTarget) return;
    const dialog = correctionDialogRef.current;
    if (!dialog) return;
    const returnFocusTarget = correctionReturnFocusRef.current;
    const background = Array.from(
      document.querySelectorAll<HTMLElement>(
        ".app-header, .workspace-heading, .action-alert, .interview-grid, .live-insight-grid, .decision-boundary-note",
      ),
    );
    for (const element of background) element.inert = true;
    const selector =
      'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])';
    const focusFrame = requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>(selector)?.focus();
    });
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !isCorrectingRef.current) {
        event.preventDefault();
        setCorrectionTarget(null);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(selector));
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      for (const element of background) element.inert = false;
      returnFocusTarget?.focus();
    };
  }, [correctionTarget]);

  useEffect(() => {
    if (!cloudConsentOpen) return;
    const dialog = cloudConsentDialogRef.current;
    const focusFrame = requestAnimationFrame(() => {
      dialog?.querySelector<HTMLButtonElement>(".button--primary")?.focus();
    });
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape" && !cloudConsentSubmitting) {
        event.preventDefault();
        setCloudConsentOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cloudConsentOpen, cloudConsentSubmitting]);

  async function sendMessage(
    text: string,
    retryCommand: PendingClaudeRetryCommand | null = null,
  ) {
    const trimmed = text.trim();
    if (
      !trimmed ||
      isSending ||
      isCompleting ||
      !snapshot ||
      snapshot.snapshotType !== "PREVIEW" ||
      audioBusy ||
      (!retryCommand && pendingClaudeRetry !== null)
    ) return;

    const command: PendingClaudeRetryCommand = retryCommand ?? {
      text: trimmed,
      clientMessageId: createClientCommandId("message"),
      expectedVersion: snapshot.version,
      currentQuestionInfoCode: snapshot.currentQuestionInfoCode,
      transcriptMetadata: null,
      processingState: "READY",
    };

    setIsSending(true);
    setSaveState("SAVING");
    setActionError(null);
    setCompletionBlockers([]);
    setAnnouncement("답변을 반영하고 다음 질문을 준비하고 있습니다.");

    try {
      const response = await authenticatedFetch(
        `/api/interviews/${encodeURIComponent(interviewId)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: command.text,
            clientMessageId: command.clientMessageId,
            expectedVersion: command.expectedVersion,
            currentQuestionInfoCode: command.currentQuestionInfoCode,
            transcriptMetadata: command.transcriptMetadata,
          }),
        },
      );
      const data = await readApiEnvelope(response);
      const processing = extractMessageProcessingTelemetry(data);
      recordMessageProcessing(processing);
      const nextSnapshot = adaptInterviewSnapshot(data);
      acceptSnapshot(nextSnapshot);
      const reducerSnapshot = reducerLiveSnapshot(data);
      dispatchLive(
        reducerSnapshot
          ? {
              type: "resync.completed",
              snapshot: reducerSnapshot,
              lastEventSeq: nextSnapshot.lastEventSeq,
            }
          : {
              type: "resync.version_completed",
              version: nextSnapshot.version,
              lastEventSeq: nextSnapshot.lastEventSeq,
            },
      );
      setMessage("");
      if (processing?.status === "APPLIED") {
        setPendingClaudeRetry(null);
        setSaveState("SAVED");
        setActionError(null);
        setAnnouncement("답변과 Claude 처리 결과가 서버 정보 상태에 반영되었습니다.");
      } else if (processing?.status === "RETRYABLE_FAILURE") {
        setPendingClaudeRetry(command);
        setSaveState("ERROR");
        setActionError(
          "답변 전사는 서버에 보존됐지만 Claude 분석에 실패했습니다. 같은 답변을 새 메시지로 다시 보내지 말고 아래 ‘Claude 분석 다시 시도’를 사용하세요.",
        );
        setAnnouncement(
          "답변 전사는 보존됐지만 Claude 분석에 실패했습니다. 자동 재시도하지 않습니다.",
        );
      } else if (processing?.status === "NON_RETRYABLE_FAILURE") {
        setPendingClaudeRetry(null);
        setSaveState("ERROR");
        setActionError(
          "답변은 서버에 보존됐지만 Claude 응답이 검증을 통과하지 못했습니다. 이 요청은 재시도되지 않으며 운영자 확인이 필요합니다.",
        );
        setAnnouncement(
          "답변은 보존됐지만 Claude 처리 결과를 적용하지 않았습니다. 자동 또는 수동 재시도는 제공되지 않습니다.",
        );
      } else {
        setPendingClaudeRetry(null);
        setSaveState("ERROR");
        setActionError(
          "답변 전사는 서버에 보존됐지만 AI 처리 상태를 확인할 수 없습니다. 같은 답변을 다시 보내지 마세요.",
        );
        setAnnouncement("답변 전사는 보존됐지만 AI 처리 상태를 확인할 수 없습니다.");
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (caught) {
      if (
        caught instanceof ApiRequestError &&
        caught.code === "CLOUD_AI_PROCESSING_CONSENT_REQUIRED"
      ) {
        setPendingCloudCommand(command);
        setCloudConsentOpen(true);
        setSaveState("SAVED");
        setAnnouncement("외부 Claude 처리 동의 후 답변을 다시 반영할 수 있습니다.");
        return;
      }
      if (shouldClearPendingMessageRetry(caught)) {
        setPendingClaudeRetry(null);
        setPendingCloudCommand(null);
        await resyncLiveSnapshot().catch(() => undefined);
      }
      setSaveState("ERROR");
      setActionError(
        caught instanceof Error
          ? caught.message
          : "답변을 전송하지 못했습니다. 입력 내용은 유지됩니다.",
      );
      setAnnouncement("답변을 반영하지 못했습니다.");
    } finally {
      setIsSending(false);
    }
  }

  async function grantCloudAiProcessingConsent() {
    const pending = pendingCloudCommand;
    if (!pending || cloudConsentSubmitting) return;
    setCloudConsentSubmitting(true);
    setActionError(null);
    try {
      const response = await authenticatedFetch(
        `/api/interviews/${encodeURIComponent(interviewId)}/consents`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            purpose: "CLOUD_AI_PROCESSING",
            consentVersion: "cloud-ai-processing-v1",
            granted: true,
            expiresAt: null,
          }),
        },
      );
      await readApiEnvelope(response);
      setCloudConsentOpen(false);
      setPendingCloudCommand(null);
      setAnnouncement("Claude 처리 동의를 기록했습니다. 보류된 답변을 반영합니다.");
      await sendMessage(pending.text, pending);
    } catch (caught) {
      setActionError(
        caught instanceof Error
          ? caught.message
          : "Claude 처리 동의를 기록하지 못했습니다.",
      );
    } finally {
      setCloudConsentSubmitting(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(message);
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (message.trim()) void sendMessage(message);
    }
  }

  async function completeInterview(mode: "COMPLETE" | "FORCE_INCOMPLETE") {
    if (
      isCompleting ||
      isSending ||
      audioBusy ||
      !borrowerConfirmationCurrent ||
      (mode === "FORCE_INCOMPLETE" && forceReason.trim().length < 3) ||
      !snapshot ||
      snapshot.snapshotType !== "PREVIEW"
    ) return;

    setIsCompleting(true);
    setSaveState("SAVING");
    setActionError(null);
    setCompletionBlockers([]);
    setAnnouncement("인터뷰 완료 조건을 확인하고 있습니다.");

    try {
      const response = await authenticatedFetch(
        `/api/interviews/${encodeURIComponent(interviewId)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientCommandId: createClientCommandId("complete"),
            expectedVersion: snapshot.version,
            mode,
            borrowerConfirmed: borrowerConfirmationCurrent,
            ...(mode === "FORCE_INCOMPLETE" ? { reason: forceReason.trim() } : {}),
          }),
        },
      );
      const data = await readApiEnvelope(response);
      const evaluationId = extractEvaluationId(data);
      if (mode === "COMPLETE") {
        if (!evaluationId) {
          throw new Error("완료된 평가 식별자를 확인할 수 없습니다.");
        }
        setAnnouncement("인터뷰가 완료되었습니다. 평가 화면으로 이동합니다.");
        setSaveState("SAVED");
        router.push(`/interview-evaluations/${encodeURIComponent(evaluationId)}`);
        return;
      }
      const finalSnapshot = adaptInterviewSnapshot(data);
      if (finalSnapshot.snapshotType !== "FINAL") {
        throw new Error("불완전 종료 스냅샷을 확인할 수 없습니다.");
      }
      acceptSnapshot(finalSnapshot);
      setSaveState("SAVED");
      setCompletionOpen(false);
      setAnnouncement("인터뷰를 불완전 상태로 종료하고 FINAL 기록을 보존했습니다.");
      setIsCompleting(false);
    } catch (caught) {
      setSaveState("ERROR");
      if (caught instanceof ApiRequestError) {
        setCompletionBlockers(caught.blockers);
      }
      setActionError(
        caught instanceof Error
          ? caught.message
          : "인터뷰를 완료하지 못했습니다.",
      );
      setAnnouncement("완료 조건을 충족하지 못했습니다.");
      setIsCompleting(false);
    }
  }

  async function submitTranscriptCorrection() {
    if (
      isCorrecting ||
      !correctionTarget ||
      !snapshot ||
      snapshot.snapshotType !== "PREVIEW" ||
      correctionText.trim().length === 0 ||
      correctionReason.trim().length === 0
    ) return;
    setIsCorrecting(true);
    setSaveState("SAVING");
    setActionError(null);
    try {
      const response = await authenticatedFetch(
        `/api/interviews/${encodeURIComponent(interviewId)}/transcript-segments/${encodeURIComponent(correctionTarget.id)}/corrections`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            clientCorrectionId: createClientCommandId("correction"),
            expectedVersion: snapshot.version,
            correctedText: correctionText.trim(),
            reason: correctionReason.trim(),
          }),
        },
      );
      await readApiEnvelope(response);
      await loadInterview();
      setCorrectionTarget(null);
      setCorrectionText("");
      setCorrectionReason("");
      setAnnouncement("전사 수정 revision과 재처리 결과가 저장되었습니다.");
    } catch (caught) {
      setSaveState("ERROR");
      setActionError(
        caught instanceof Error ? caught.message : "전사 수정 내용을 저장하지 못했습니다.",
      );
    } finally {
      setIsCorrecting(false);
    }
  }

  if (isLoading && !snapshot) {
    return (
      <main id="main-content" className="workspace-page">
        <LoadingState
          title="인터뷰를 불러오는 중입니다"
          description="저장된 대화와 정보 상태를 확인하고 있습니다."
        />
      </main>
    );
  }

  if (loadError || !snapshot) {
    return (
      <main id="main-content" className="workspace-page">
        <ErrorState
          title="인터뷰를 불러오지 못했습니다"
          description={loadError ?? "인터뷰 응답을 확인할 수 없습니다."}
          onRetry={() => void loadInterview()}
          retrying={isLoading}
        />
      </main>
    );
  }

  if (snapshot.snapshotType === "FINAL") {
    return <FinalInterviewRecord snapshot={snapshot} />;
  }

  const sessionInteractionDisabled =
    isLoading || isSending || isCompleting || isCorrecting || audioBusy || snapshot.lifecycleStatus !== "ACTIVE";
  const responseDisabled =
    sessionInteractionDisabled ||
    snapshot.currentQuestionInfoCode === null ||
    pendingClaudeRetry !== null;
  const currentInformationItem = snapshot.informationItems.find(
    (item) => item.infoCode === snapshot.currentQuestionInfoCode,
  );
  const optionalItems = snapshot.informationItems.filter(
    (item) => !item.required,
  );
  const completedOptionalItems = optionalItems.filter(
    (item) => item.bucket === "completed",
  );
  const confirmedGoalCount = snapshot.goal?.status === "CONFIRMED" ? 1 : 0;
  const recentInfoCodes = new Set(informationChanges.map((change) => change.infoCode));

  return (
    <main
      id="main-content"
      className="workspace-page"
      data-presentation={presentationMode ? "true" : undefined}
    >
      <JourneyNav steps={ADMIN_JOURNEY} current={0} label="관리자 업무 전체 흐름" />
      <Link className="service-back-link" href="/interviews">← 상담 대장</Link>
      <div className="workspace-heading">
        <div>
          <div className="workspace-heading__eyebrow">
            <span className="badge badge--preview">작성 중인 기록</span>
            <span>담당자 인터뷰 작업공간</span>
            <span className="lifecycle-state" data-state={snapshot.lifecycleStatus.toLowerCase()}>
              {snapshot.lifecycleStatus === "ACTIVE" ? "진행 중" : snapshot.lifecycleStatus}
            </span>
            <span className="connection-state" data-state={liveState.sseConnection.toLowerCase()}>
              {liveState.sseConnection === "OPEN" ? "기록 연결됨" : liveState.sseConnection === "ERROR" || liveState.sseConnection === "CLOSED" ? "기록 연결 끊김 · 새로고침 필요" : "기록 다시 연결 중"}
            </span>
          </div>
          <h1>{snapshot.businessName}</h1>
          <div className="workspace-heading__meta">
            <span>
              <UserRound size={14} aria-hidden="true" />
              {snapshot.borrowerName}
            </span>
            <span>
              <BriefcaseBusiness size={14} aria-hidden="true" />
              {snapshot.industry}
            </span>
            <span>
              <Clock3 size={14} aria-hidden="true" />
              {formatDateTime(snapshot.updatedAt)} 갱신
            </span>
          </div>
        </div>
        <div className="workspace-heading__actions">
          <button
            className="icon-button"
            type="button"
            onClick={() => void loadInterview()}
            disabled={isLoading || isSending || isCompleting}
            aria-label="인터뷰 상태 새로고침"
            title="상태 새로고침"
          >
            <RefreshCw className={isLoading ? "spin" : undefined} size={18} />
          </button>
          <button
            ref={completionTriggerRef}
            className="button button--complete"
            type="button"
            onClick={() => {
              setCompletionOpen(true);
              setActionError(null);
              setCompletionBlockers([]);
            }}
            disabled={sessionInteractionDisabled}
            title="완료 조건과 차주 확인 여부를 검토합니다"
          >
            {isCompleting ? (
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
            ) : (
              <Flag size={17} aria-hidden="true" />
            )}
            {isCompleting ? "종료 처리 중" : "완료 검토"}
          </button>
        </div>
      </div>

      <details className="service-diagnostics">
      <summary>연결·처리 상태 상세 <span>이벤트·버전·음성 진단</span></summary>
      <LiveRealtimeStatus
        overallRate={snapshot.overallRate}
        resolvedRequired={snapshot.resolvedRequired}
        totalRequired={snapshot.totalRequired}
        saveState={saveState}
        connection={liveState.sseConnection}
        version={snapshot.version}
        lastEventSeq={Math.max(snapshot.lastEventSeq, liveState.lastEventSeq)}
        updatedAt={snapshot.updatedAt}
        lastObservedEventType={liveState.lastObservedEventType}
        lastObservedEventAt={liveState.lastObservedEventAt}
        recentEventTypes={recentEventTypes}
        batchPending={liveState.batchPending}
        batchIndex={liveState.currentBatchIndex}
        batchSize={liveState.currentBatchSize}
        audioState={liveState.audio.uxState}
        audioProvider={liveState.audio.providerLabel}
        messageProcessing={lastMessageProcessing}
        changes={informationChanges}
        liveSummary={snapshot.liveSummary}
        goalSummary={
          snapshot.goal && snapshot.goal.status !== "UNRESOLVED"
            ? [
                snapshot.goal.baseline && snapshot.goal.target
                  ? `${snapshot.goal.baseline} → ${snapshot.goal.target}`
                  : snapshot.goal.title,
                snapshot.goal.period,
              ].filter(Boolean).join(" · ")
            : null
        }
        presentationMode={presentationMode}
        onTogglePresentation={() => setPresentationMode((current) => !current)}
      />
      </details>

      <section className="workspace-context" aria-label="차주, 사업 및 기존정보 요약">
        <div className="workspace-context__identity">
          <p className="panel-kicker">사업자 정보</p>
          <dl>
            <div>
              <dt>차주</dt>
              <dd>{snapshot.borrowerName}</dd>
            </div>
            <div>
              <dt>사업체</dt>
              <dd>{snapshot.businessName}</dd>
            </div>
            <div>
              <dt>업종</dt>
              <dd>{snapshot.industry}</dd>
            </div>
            <div>
              <dt>업력</dt>
              <dd className="workspace-context__missing">연결 정보 없음</dd>
            </div>
            <div>
              <dt>지역</dt>
              <dd className="workspace-context__missing">연결 정보 없음</dd>
            </div>
            <div>
              <dt>Interview ID</dt>
              <dd title={snapshot.id}>{snapshot.id}</dd>
            </div>
          </dl>
        </div>
        <div className="workspace-context__reference">
          <div>
            <p className="panel-kicker">인터뷰 정보</p>
            <span>사장님이 확인한 내용부터 기록합니다</span>
          </div>
          <p className="workspace-context__empty-reference">
            외부 매출·CB·대출 정보는 연결하지 않았습니다. 인터뷰 중 사장님이 직접 확인한 답변과 근거만 이 기록에 반영됩니다.
          </p>
        </div>
      </section>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      {actionError && (
        <section className="action-alert" role="alert" aria-labelledby="action-error-title">
          <AlertTriangle size={19} aria-hidden="true" />
          <div>
            <strong id="action-error-title">
              {pendingClaudeRetry ? "Claude 분석 재처리 필요" : "요청을 마치지 못했습니다"}
            </strong>
            <p>{actionError}</p>
            {pendingClaudeRetry && (
              <div className="action-alert__retry">
                <button
                  className="button button--ghost"
                  type="button"
                  disabled={sessionInteractionDisabled}
                  onClick={() =>
                    void sendMessage(pendingClaudeRetry.text, pendingClaudeRetry)
                  }
                >
                  <RefreshCw size={15} aria-hidden="true" />
                  Claude 분석 다시 시도
                </button>
                <small>
                  동일 저장 명령을 재사용해 기존 전사를 분석하며 새 전사를 추가하지 않습니다.
                  자동 재시도는 하지 않습니다.
                </small>
              </div>
            )}
            {completionBlockers.length > 0 && (
              <ul>
                {completionBlockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}

      {cloudConsentOpen && (
        <div className="completion-modal" role="presentation">
          <section
            ref={cloudConsentDialogRef}
            className="completion-dialog cloud-ai-consent-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cloud-ai-consent-title"
            aria-describedby="cloud-ai-consent-description"
          >
            <div className="completion-dialog__heading">
              <div>
                <p className="panel-kicker">외부 AI 처리 동의 · v1</p>
                <h2 id="cloud-ai-consent-title">Claude 인터뷰 처리 동의</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="Claude 처리 동의 창 닫기"
                disabled={cloudConsentSubmitting}
                onClick={() => setCloudConsentOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="microphone-consent-dialog__body">
              <p id="cloud-ai-consent-description">
                확정된 차주 답변과 현재 인터뷰 정보 상태를 Anthropic Claude API로 보내
                정보 추출 후보와 다음 질문을 생성합니다. 서버는 결과를 그대로 신용판단에
                쓰지 않고 허용 정보코드·원문 근거·수치·상태전이를 다시 검증합니다.
              </p>
              <ul>
                <li>대출 승인·거절, 공식·추정 신용등급 또는 위험점수를 생성하지 않습니다.</li>
                <li>API 키, 원본 오디오와 일반 오류 로그는 외부 요청에 포함하지 않습니다.</li>
                <li>동의하지 않으면 현재 Claude 모드에서는 답변을 외부로 보내지 않습니다.</li>
              </ul>
              <div className="microphone-consent-dialog__actions">
                <button
                  type="button"
                  className="button button--ghost"
                  disabled={cloudConsentSubmitting}
                  onClick={() => setCloudConsentOpen(false)}
                >
                  동의하지 않음
                </button>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={cloudConsentSubmitting}
                  onClick={() => void grantCloudAiProcessingConsent()}
                >
                  {cloudConsentSubmitting
                    ? <LoaderCircle className="spin" size={17} />
                    : <Check size={17} />}
                  동의하고 답변 반영
                </button>
              </div>
            </div>
          </section>
        </div>
      )}

      {completionOpen && (
        <div className="completion-modal" role="presentation">
          <section
            ref={completionDialogRef}
            className="completion-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="completion-dialog-title"
          >
            <div className="completion-dialog__heading">
              <div>
                <p className="panel-kicker">기록을 마치기 전에</p>
                <h2 id="completion-dialog-title">인터뷰 종료 방식 확인</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setCompletionOpen(false)}
                disabled={isCompleting}
                aria-label="종료 검토 닫기"
              >
                ×
              </button>
            </div>
            <label className="confirmation-check completion-shared-confirmation">
              <input
                type="checkbox"
                checked={borrowerConfirmationCurrent}
                disabled={isCompleting}
                onChange={(event) => {
                  setBorrowerConfirmed(event.target.checked);
                  setBorrowerConfirmationVersion(event.target.checked ? snapshot.version : null);
                }}
              />
              사장님과 현재까지의 답변 및 기록 종료를 확인했습니다. 두 종료 방식 모두 확인이 필요합니다.
            </label>
            <div className="completion-dialog__body">
              <article className="completion-option completion-option--complete">
                <div>
                  <CheckCircle2 size={20} />
                  <div>
                    <h3>정상 완료</h3>
                    <p>
                      필요한 값과 근거, 상충 답변을 확인한 뒤 완료 기록과 인터뷰 데이터 품질 평가를 생성합니다.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  className="button button--primary"
                  disabled={!borrowerConfirmationCurrent || isCompleting}
                  onClick={() => void completeInterview("COMPLETE")}
                >
                  {isCompleting ? <LoaderCircle className="spin" size={17} /> : <Flag size={17} />}
                  정상 완료 검증
                </button>
              </article>

              <article className="completion-option completion-option--force">
                <div>
                  <AlertTriangle size={20} />
                  <div>
                    <h3>불완전 상태로 중단</h3>
                    <p>
                      미확인 항목을 포함한 종료 기록을 저장합니다. 데이터 품질 등급은 만들지 않으며, 중단 사유를 함께 남깁니다.
                    </p>
                  </div>
                </div>
                <label htmlFor="force-stop-reason">중단 사유</label>
                <textarea
                  id="force-stop-reason"
                  value={forceReason}
                  onChange={(event) => setForceReason(event.target.value)}
                  rows={3}
                  maxLength={500}
                  disabled={isCompleting}
                  placeholder="예: 차주 요청으로 인터뷰를 조기 종료함"
                />
                <button
                  type="button"
                  className="button button--danger-outline"
                  disabled={!borrowerConfirmationCurrent || forceReason.trim().length < 3 || isCompleting}
                  onClick={() => void completeInterview("FORCE_INCOMPLETE")}
                >
                  <CircleHelp size={17} /> 불완전 종료본 저장
                </button>
              </article>
            </div>
            {(actionError || completionBlockers.length > 0) && (
              <div className="completion-dialog__error" role="alert">
                <AlertTriangle size={18} />
                <div>
                  <strong>{actionError ?? "완료 조건을 충족하지 못했습니다."}</strong>
                  {completionBlockers.length > 0 && (
                    <ul>
                      {completionBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}

      {correctionTarget && (
        <div className="completion-modal" role="presentation">
          <section ref={correctionDialogRef} className="completion-dialog correction-dialog" role="dialog" aria-modal="true" aria-labelledby="correction-title">
            <div className="completion-dialog__heading">
              <div>
                <p className="panel-kicker">전사 수정</p>
                <h2 id="correction-title">확정 전사 수정</h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label="전사 수정 닫기"
                disabled={isCorrecting}
                onClick={() => setCorrectionTarget(null)}
              >×</button>
            </div>
            <div className="correction-dialog__body">
              <div className="correction-original">
                <span>불변 원문 · revision {correctionTarget.revision}</span>
                <blockquote>{correctionTarget.rawText}</blockquote>
              </div>
              <label htmlFor="corrected-transcript">수정 전사</label>
              <textarea
                id="corrected-transcript"
                value={correctionText}
                onChange={(event) => setCorrectionText(event.target.value)}
                rows={4}
                maxLength={5000}
              />
              <label htmlFor="correction-reason">수정 사유</label>
              <input
                id="correction-reason"
                value={correctionReason}
                onChange={(event) => setCorrectionReason(event.target.value)}
                maxLength={500}
                placeholder="예: STT가 2,300만원을 230만원으로 잘못 전사함"
              />
              <p>
                원문을 덮어쓰지 않고 correction revision을 추가하며, 기존 파생값은 supersede 후 재추출합니다.
              </p>
              <button
                type="button"
                className="button button--primary"
                disabled={isCorrecting || !correctionText.trim() || !correctionReason.trim()}
                onClick={() => void submitTranscriptCorrection()}
              >
                {isCorrecting ? <LoaderCircle className="spin" size={17} /> : <PencilLine size={17} />}
                수정 revision 저장
              </button>
            </div>
          </section>
        </div>
      )}

      <div className="interview-grid">
        <aside className="interview-pillar-panel" aria-labelledby="pillar-heading">
          <div className="panel-heading">
            <div>
              <p className="panel-kicker">정보 수집 현황</p>
              <h2 id="pillar-heading">4대 정보축</h2>
            </div>
            <span className="coverage-number">{formatPercent(snapshot.overallRate)}</span>
          </div>

          <div className="overall-progress">
            <div>
              <span>전체 정보 충족률</span>
              <span>
                {snapshot.resolvedRequired ?? "—"} / {snapshot.totalRequired ?? "—"}
              </span>
            </div>
            <ProgressBar value={snapshot.overallRate} label="전체 정보 충족률" />
          </div>

          <div className="pillar-list">
            {snapshot.pillars.map((pillar) => {
              const Icon = pillarIcons[pillar.key];
              return (
                <article
                  className="pillar-progress"
                  data-active={currentInformationItem?.category === pillar.key ? "true" : undefined}
                  key={pillar.key}
                >
                  <div className="pillar-progress__icon">
                    <Icon size={18} aria-hidden="true" />
                  </div>
                  <div className="pillar-progress__body">
                    <div className="pillar-progress__label">
                      <strong>{pillar.label}</strong>
                      <span>
                        {currentInformationItem?.category === pillar.key && (
                          <em>현재 질문</em>
                        )}
                        {formatPercent(pillar.confirmationRate)}
                      </span>
                    </div>
                    <ProgressBar
                      value={pillar.confirmationRate}
                      label={`${pillar.label} 정보 충족률`}
                    />
                    <p>{pillar.shortDescription}</p>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="pillar-note">
            <Info size={16} aria-hidden="true" />
            <p>
              화면의 비율과 상태는 서버 스냅샷을 그대로 표시하며, 브라우저에서
              별도 평가를 계산하지 않습니다.
            </p>
          </div>
        </aside>

        <section className="conversation-panel" aria-labelledby="conversation-heading">
          <div className="current-question">
            <div className="current-question__label">
              현재 질문
              {snapshot.questionReason && (
                <span>{questionReasonLabel(snapshot.questionReason)}</span>
              )}
            </div>
            <h2 id="conversation-heading">
              {snapshot.currentQuestion ?? "모든 예정 질문이 완료되었습니다."}
            </h2>
            {currentInformationItem && (
              <div className="current-question__context">
                <span>확인 대상</span>
                <strong>{currentInformationItem.label}</strong>
                <small>{currentInformationItem.categoryLabel}</small>
              </div>
            )}
          </div>

          <div className="transcript" aria-label="인터뷰 대화 내용">
            {snapshot.transcript.length > 0 ? (
              snapshot.transcript.map((segment) => (
                <article
                  className="transcript-message"
                  data-speaker={segment.speaker.toLowerCase()}
                  key={segment.id}
                >
                  <div className="transcript-message__avatar" aria-hidden="true">
                    {segment.speaker === "ASSISTANT" ? (
                      <MessageSquareText size={16} />
                    ) : (
                      <UserRound size={16} />
                    )}
                  </div>
                  <div className="transcript-message__content">
                    <div className="transcript-message__meta">
                      <strong>{segment.speaker === "ASSISTANT" ? "AI 인터뷰" : "차주"}</strong>
                      <time dateTime={segment.createdAt}>
                        {transcriptTime(segment.createdAt)}
                      </time>
                    </div>
                    <p>{segment.text}</p>
                    {segment.speaker === "BORROWER" && (
                      <div className="transcript-message__trace">
                        <span>rev {segment.revision}</span>
                        {segment.correctedText && <span>수정 전사 적용</span>}
                        {segment.startMs !== null && segment.endMs !== null && (
                          <span>{segment.startMs}–{segment.endMs}ms</span>
                        )}
                        {segment.sttProvider && <span>{segment.sttProvider}</span>}
                        <button
                          type="button"
                          onClick={() => {
                            correctionReturnFocusRef.current = document.activeElement as HTMLElement | null;
                            setCorrectionTarget(segment);
                            setCorrectionText(segment.text);
                            setCorrectionReason("");
                          }}
                          disabled={sessionInteractionDisabled}
                        >
                          <PencilLine size={12} /> 전사 수정
                        </button>
                      </div>
                    )}
                    {segment.correctedText && segment.rawText !== segment.correctedText && (
                      <details className="transcript-raw">
                        <summary>수정 전 원문 보기</summary>
                        <p>{segment.rawText}</p>
                      </details>
                    )}
                  </div>
                </article>
              ))
            ) : (
              <div className="transcript-empty">
                <MessageSquareText size={22} aria-hidden="true" />
                <strong>첫 답변을 기다리고 있습니다.</strong>
                <p>아래 입력창에 차주의 답변을 그대로 입력해 주세요.</p>
              </div>
            )}
            {isSending && (
              <div className="processing-row" role="status">
                <LoaderCircle className="spin" size={17} aria-hidden="true" />
                답변을 분석하고 정보 상태를 갱신하는 중입니다.
              </div>
            )}
            <div ref={transcriptEndRef} />
          </div>

          <AudioInterviewControls
            interviewId={interviewId}
            currentQuestion={snapshot.currentQuestion}
            disabled={responseDisabled}
            onServerFinal={async () => {
              setSaveState("SYNCING");
              setAnnouncement("음성 답변이 서버에 확정되어 정보 상태를 동기화합니다.");
              await loadInterview();
            }}
            onBusyChange={setAudioBusy}
            onStatusChange={handleAudioStatus}
          />

          <form className="message-composer" onSubmit={handleSubmit}>
            <label className="sr-only" htmlFor="borrower-answer">
              차주 답변
            </label>
            <textarea
              ref={inputRef}
              id="borrower-answer"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={handleInputKeyDown}
              placeholder={
                snapshot.currentQuestionInfoCode === null
                  ? "응답할 예정 질문이 없습니다"
                  : "차주의 답변을 입력하세요"
              }
              rows={2}
              maxLength={5000}
              disabled={responseDisabled}
              aria-describedby="answer-help"
            />
            <button
              className="send-button"
              type="submit"
              disabled={responseDisabled || !message.trim()}
              aria-label="답변 전송"
            >
              {isSending ? (
                <LoaderCircle className="spin" size={18} aria-hidden="true" />
              ) : (
                <Send size={18} aria-hidden="true" />
              )}
            </button>
            <div className="message-composer__footer" id="answer-help">
              <span>Enter로 전송 · Shift+Enter로 줄바꿈</span>
              <span>{message.length} / 5,000</span>
            </div>
          </form>
        </section>

        <aside className="information-panel" aria-labelledby="information-heading">
          <div className="panel-heading information-panel__heading">
            <div>
              <p className="panel-kicker">서버 상태</p>
              <h2 id="information-heading">정보 수집 상태</h2>
            </div>
            <span className="snapshot-version">v{snapshot.version}</span>
          </div>

          <div className="status-legend" aria-label="특수 정보 상태 안내">
            <span data-state="unavailable">확인 불가</span>
            <span data-state="refused">응답 거절</span>
            <span data-state="not_applicable">해당 없음</span>
          </div>

          <div className="status-buckets">
            {(Object.keys(bucketMeta) as InformationBucketKey[]).map((bucketKey) => (
              <StatusBucket
                bucketKey={bucketKey}
                evidence={snapshot.evidence}
                items={snapshot.buckets[bucketKey]}
                recentInfoCodes={recentInfoCodes}
                key={bucketKey}
              />
            ))}
          </div>
        </aside>
      </div>

      <section className="live-insight-grid" aria-label="실시간 요약과 영역별 커버리지">
        <details className="operator-technical-details"><summary>계산 지표와 산식 확인</summary><LiveFeaturePanel
          features={snapshot.features}
          changes={featureChanges}
          registryVersion={snapshot.featureRegistryVersion}
          stateVersion={snapshot.featureStateVersion}
        /></details>
        <article className="live-summary-card">
          <div className="insight-heading">
            <div>
              <p className="panel-kicker">답변 요약</p>
              <h2>현재까지 확인된 핵심 내용</h2>
            </div>
            <span className="badge badge--preview">작성 중</span>
          </div>
          {snapshot.liveSummary ? (
            <p className="live-summary-card__text">{readableInformationText(snapshot.liveSummary, snapshot.informationItems)}</p>
          ) : (
            <div className="summary-empty">
              <Info size={18} aria-hidden="true" />
              <div>
                <strong>아직 요약할 답변이 없습니다.</strong>
                <p>
                  답변이 모이면 확인한 내용을 함께 정리합니다.
                </p>
              </div>
            </div>
          )}
          <div className="summary-footnote">
            <Check size={15} aria-hidden="true" />
            인터뷰 중 임시 정보이며 최종 평가에 자동 사용되지 않습니다.
          </div>
        </article>

        <article className="live-goal-card">
          <div className="insight-heading">
            <div>
              <p className="panel-kicker">목표 검토</p>
              <h2>차주 진술 개선 목표</h2>
            </div>
            <span className="badge badge--preview">{goalStatusLabel(snapshot.goal?.status)}</span>
          </div>
          {snapshot.goal && snapshot.goal.status !== "UNRESOLVED" ? (
            <>
              <strong className="live-goal-card__title">
                {snapshot.goal.title ??
                  (snapshot.goal.status === "NO_GOAL_STATED" ? "차주가 명시한 목표 없음" : "목표 제목 추가 확인")}
              </strong>
              <dl className="live-goal-card__values">
                <div>
                  <dt>현재값</dt>
                  <dd>{snapshot.goal.baseline ?? "—"}</dd>
                </div>
                <div>
                  <dt>목표값</dt>
                  <dd>{snapshot.goal.target ?? "—"}</dd>
                </div>
                <div>
                  <dt>기간</dt>
                  <dd>{snapshot.goal.period ?? "—"}</dd>
                </div>
              </dl>
              <p className="live-goal-card__source">
                측정원 {snapshot.goal.measurementSource ?? "추가 확인"}
                {snapshot.goal.behaviorEvent?.source &&
                  snapshot.goal.behaviorEvent.source !== snapshot.goal.measurementSource
                  ? ` · Event ${snapshot.goal.behaviorEvent.source}`
                  : ""}
              </p>
              <div className="summary-footnote">
                <Target size={15} aria-hidden="true" />
                서버 goalSnapshot · 근거 {snapshot.goal.evidenceIds.length}개 연결
              </div>
            </>
          ) : (
            <div className="summary-empty">
              <Target size={18} aria-hidden="true" />
              <div>
                <strong>확정된 개선 목표가 아직 없습니다.</strong>
                <p>현재값·목표값·기간·측정원이 수집되면 서버 PREVIEW를 표시합니다.</p>
              </div>
            </div>
          )}
        </article>

        <PillarCoveragePreview
          pillars={snapshot.pillars}
          changes={pillarCoverageChanges}
          requiredInformationRate={snapshot.requiredInformationRate}
        />
      </section>

      <section className="completion-sticky" data-ready={!snapshot.currentQuestion && !snapshot.pendingCommand && !sessionInteractionDisabled} aria-labelledby="completion-sticky-heading">
        <div className="completion-sticky__heading">
          <p className="panel-kicker">종료 전 확인</p>
          <h2 id="completion-sticky-heading">인터뷰 종료 준비</h2>
        </div>
        <dl className="completion-sticky__metrics">
          <div>
            <dt>필수정보</dt>
            <dd>{snapshot.resolvedRequired ?? "—"} / {snapshot.totalRequired ?? "—"}</dd>
          </div>
          <div>
            <dt>추가정보</dt>
            <dd>{completedOptionalItems.length} / {optionalItems.length}</dd>
          </div>
          <div data-alert={snapshot.buckets.conflict.length > 0 ? "true" : undefined}>
            <dt>미해결 충돌</dt>
            <dd>{snapshot.buckets.conflict.length}</dd>
          </div>
          <div>
            <dt>확정 목표</dt>
            <dd>{confirmedGoalCount}</dd>
          </div>
        </dl>
        <div className="completion-sticky__action">
          {(snapshot.unresolvedRequired ?? 0) > 0 ? (
            <p>필수정보 {snapshot.unresolvedRequired}개가 아직 확인되지 않았습니다.</p>
          ) : snapshot.buckets.conflict.length > 0 ? (
            <p>미해결 정보충돌 {snapshot.buckets.conflict.length}건을 먼저 확인하세요.</p>
          ) : (
            <p>최종 완료조건은 서버가 다시 검증합니다.</p>
          )}
          <button
            className="button button--complete"
            type="button"
            onClick={() => {
              setCompletionOpen(true);
              setActionError(null);
              setCompletionBlockers([]);
            }}
            disabled={sessionInteractionDisabled}
          >
            {isCompleting ? (
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
            ) : (
              <Flag size={17} aria-hidden="true" />
            )}
            {isCompleting ? "종료 처리 중" : "완료 조건 검토"}
          </button>
        </div>
      </section>

      <div className="decision-boundary-note">
        <Info size={16} aria-hidden="true" />
        <p>
          이 화면은 인터뷰 진행을 돕는 PREVIEW 정보입니다. 대출 승인·거절을
          판단하거나 공식 신용평가를 대체하지 않습니다.
        </p>
      </div>
    </main>
  );
}
