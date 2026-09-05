"use client";

import {
  AlertCircle,
  ArrowLeft,
  BadgeCheck,
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  ClipboardCheck,
  ExternalLink,
  FileCheck2,
  FileText,
  Gauge,
  House,
  Info,
  Landmark,
  Link2,
  ShieldAlert,
  Target,
  TrendingUp,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  adaptEvaluation,
  adaptModelingScorecard,
  authenticatedFetch,
  formatDateTime,
  formatPercent,
  selectEvaluationPillarLineage,
  type EvaluationView,
  type ModelingScorecardView,
  type PillarKey,
  type ScorecardAxisView,
  readApiEnvelope,
} from "@/components/api-adapter";
import { ErrorState, LoadingState } from "@/components/request-state";

interface EvaluationReportProps {
  evaluationId: string;
}

const pillarIcons = {
  CURRENT_STATE: Landmark,
  FUTURE_OUTLOOK: TrendingUp,
  IMPROVEMENT_INTENT: Target,
  HOUSEHOLD_STATE: House,
} satisfies Record<PillarKey, typeof Landmark>;

const featureStateLabels: Record<string, string> = {
  COMPUTED: "계산됨",
  MISSING: "입력 부족",
  UNKNOWN: "확인 불가",
  REFUSED: "응답 거절",
  NOT_APPLICABLE: "해당 없음",
  CONFLICTING: "정보 충돌",
  NOT_CALCULABLE: "계산 불가",
};

function featureStateLabel(value: string): string {
  return featureStateLabels[value] ?? value;
}

function ScoreBar({ value, label }: { value: number | null; label: string }) {
  return (
    <div
      className="score-track"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={value === null ? undefined : Math.round(value)}
      aria-valuetext={value === null ? "집계되지 않음" : formatPercent(value)}
    >
      <span style={{ width: value === null ? "0%" : `${value}%` }} />
    </div>
  );
}

function ScorecardAxisBlock({ label, axis }: { label: string; axis: ScorecardAxisView }) {
  return (
    <div className="scorecard-axis">
      <div className="scorecard-axis__head">
        <span>{label}</span>
        <strong>{axis.scoreLabel}</strong>
      </div>
      <ScoreBar value={axis.score} label={`${label} 점수`} />
      <p className="scorecard-axis__basis">{axis.basis}</p>
      <ul className="scorecard-axis__items">
        {axis.items.map((item) => (
          <li key={item.name} data-excluded={item.excluded || undefined}>
            <span>{item.name}</span>
            <em>{item.excluded ? "산출 제외" : `${item.points ?? "—"}점`}</em>
            <small>
              {item.band}
              {item.note ? ` · ${item.note}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * modeling 파이프라인이 계산한 2축 점수. 값은 화면에서 만들지 않고 받은 것만
 * 보여 주며, 파이프라인이 준비되지 않으면 점수 자리를 비워 둔다.
 */
function ModelingScorecardCard({ scorecard }: { scorecard: ModelingScorecardView | null }) {
  return (
    <article className="assessment-card assessment-card--scorecard">
      <div className="assessment-card__heading">
        <div className="assessment-card__icon">
          <Gauge size={21} aria-hidden="true" />
        </div>
        <div>
          <span>거래 데이터와 인터뷰</span>
          <h3>2축 스코어카드</h3>
        </div>
        <span className="source-chip">심사 참고자료</span>
      </div>

      {scorecard?.status === "READY" && scorecard.currentSituation && scorecard.improvement ? (
        <>
          <ScorecardAxisBlock label="현재 상황" axis={scorecard.currentSituation} />
          <ScorecardAxisBlock label="개선가능성" axis={scorecard.improvement} />
          <div className="approval-null">
            <Info size={15} aria-hidden="true" />
            승인·거절 판단이 아니며 신용등급도 아닙니다.
            {scorecard.transactionDataSource
              ? ` 거래 데이터는 데모용 mock 케이스(${scorecard.transactionDataSource})입니다.`
              : ""}
          </div>
          {scorecard.reproduceCommand && (
            <p className="scorecard-reproduce">
              재현: <code>{scorecard.reproduceCommand}</code>
            </p>
          )}
        </>
      ) : (
        <div className="assessment-empty">
          <ShieldAlert size={18} aria-hidden="true" />
          <div>
            <strong>2축 점수를 계산하지 않았습니다.</strong>
            <p>
              {scorecard?.unavailableMessage ??
                "modeling 파이프라인 응답을 받지 못했습니다. 점수를 추정해 채우지 않습니다."}
            </p>
          </div>
        </div>
      )}
    </article>
  );
}

export function EvaluationReport({ evaluationId }: EvaluationReportProps) {
  const [evaluation, setEvaluation] = useState<EvaluationView | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showTechnicalFeatureDetails, setShowTechnicalFeatureDetails] = useState(false);
  const [selectedPillarKey, setSelectedPillarKey] = useState<PillarKey | null>(null);
  const [scorecard, setScorecard] = useState<ModelingScorecardView | null>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);

  const fetchEvaluation = useCallback(async () => {
    const response = await authenticatedFetch(
      `/api/interview-evaluations/${encodeURIComponent(evaluationId)}`,
      { cache: "no-store" },
    );
    const data = await readApiEnvelope(response);
    let view = adaptEvaluation(data);

    // The evaluation contract intentionally contains no borrower or evidence
    // duplication. Read the associated interview snapshot only as display context.
    try {
      const interviewResponse = await authenticatedFetch(
        `/api/interviews/${encodeURIComponent(view.interviewId)}`,
        { cache: "no-store" },
      );
      const supportingSnapshot = await readApiEnvelope(interviewResponse);
      view = adaptEvaluation(data, supportingSnapshot);
    } catch {
      // Evaluation remains independently readable if supporting context is unavailable.
    }

    return view;
  }, [evaluationId]);

  const loadEvaluation = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      setEvaluation(await fetchEvaluation());
    } catch (caught) {
      setLoadError(
        caught instanceof Error
          ? caught.message
          : "인터뷰 평가를 불러오지 못했습니다.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [fetchEvaluation]);

  useEffect(() => {
    let active = true;

    fetchEvaluation()
      .then((nextEvaluation) => {
        if (active) setEvaluation(nextEvaluation);
      })
      .catch((caught: unknown) => {
        if (!active) return;
        setLoadError(
          caught instanceof Error
            ? caught.message
            : "인터뷰 평가를 불러오지 못했습니다.",
        );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [fetchEvaluation]);

  // 2축 점수는 별도로 읽는다. modeling 파이프라인이 준비되지 않아도 평가 화면은
  // 그대로 열려야 하기 때문이다.
  useEffect(() => {
    let active = true;

    authenticatedFetch(
      `/api/interview-evaluations/${encodeURIComponent(evaluationId)}/scorecard`,
      { cache: "no-store" },
    )
      .then((response) => readApiEnvelope(response))
      .then((data) => {
        if (active) setScorecard(adaptModelingScorecard(data));
      })
      .catch(() => {
        if (active) setScorecard(null);
      });

    return () => {
      active = false;
    };
  }, [evaluationId]);

  const closePillarDrawer = useCallback(() => {
    setSelectedPillarKey(null);
    window.setTimeout(() => drawerReturnFocusRef.current?.focus(), 0);
  }, []);

  useEffect(() => {
    if (!selectedPillarKey) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        closePillarDrawer();
        return;
      }
      if (event.key !== "Tab") return;
      const drawer = drawerCloseRef.current?.closest<HTMLElement>(".evaluation-drawer");
      if (!drawer) return;
      const focusable = Array.from(
        drawer.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.getClientRects().length > 0);
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
    window.requestAnimationFrame(() => drawerCloseRef.current?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePillarDrawer, selectedPillarKey]);

  if (isLoading && !evaluation) {
    return (
      <main id="main-content" className="evaluation-page">
        <LoadingState
          title="최종 평가를 불러오는 중입니다"
          description="확정된 스냅샷과 인터뷰 보조평가를 확인하고 있습니다."
        />
      </main>
    );
  }

  if (loadError || !evaluation) {
    return (
      <main id="main-content" className="evaluation-page">
        <ErrorState
          title="인터뷰 평가를 불러오지 못했습니다"
          description={loadError ?? "평가 응답을 확인할 수 없습니다."}
          onRetry={() => void loadEvaluation()}
          retrying={isLoading}
        />
      </main>
    );
  }

  const selectedPillar = selectedPillarKey
    ? evaluation.pillars.find((pillar) => pillar.key === selectedPillarKey) ?? null
    : null;
  const selectedLineage = selectedPillar
    ? selectEvaluationPillarLineage(evaluation, selectedPillar)
    : null;
  const allContributingFeatureNames = new Set(
    evaluation.pillars.flatMap((pillar) => pillar.contributingFeatureNames),
  );

  return (
    <main id="main-content" className="evaluation-page">
      {selectedPillar && selectedLineage && (
        <div
          className="evaluation-drawer-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) closePillarDrawer();
          }}
        >
          <section
            className="evaluation-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="evaluation-drawer-title"
          >
            <header className="evaluation-drawer__header">
              <div>
                <p className="panel-kicker">PILLAR EVIDENCE DETAIL</p>
                <h2 id="evaluation-drawer-title">{selectedPillar.label} 상세</h2>
              </div>
              <button
                ref={drawerCloseRef}
                type="button"
                className="icon-button"
                onClick={closePillarDrawer}
                aria-label={`${selectedPillar.label} 상세 닫기`}
              >
                <X size={19} aria-hidden="true" />
              </button>
            </header>

            <div className="evaluation-drawer__body">
              <section className="evaluation-drawer__score" aria-label={`${selectedPillar.label} 종합`}>
                <div>
                  <span>인터뷰 데이터 품질</span>
                  <strong>{selectedPillar.levelLabel}</strong>
                  <b>{formatPercent(selectedPillar.score)}</b>
                </div>
                <ScoreBar value={selectedPillar.score} label={`${selectedPillar.label} 인터뷰 데이터 품질`} />
                <p>{selectedPillar.summary}</p>
                <div className="evaluation-lineage-notice">
                  <BadgeCheck size={15} aria-hidden="true" />
                  <span>
                    아래의 평가 기여 피처와 근거는 서버 FINAL 평가에 저장된 목록만 표시합니다.
                  </span>
                </div>
              </section>

              <section className="evaluation-drawer__metrics" aria-labelledby="drawer-metrics-heading">
                <h3 id="drawer-metrics-heading">산정에 사용된 수집 상태</h3>
                <div>
                  <article>
                    <span>확인률</span>
                    <strong>{formatPercent(selectedPillar.confirmationRate)}</strong>
                    <ScoreBar value={selectedPillar.confirmationRate} label={`${selectedPillar.label} 확인률`} />
                  </article>
                  <article>
                    <span>평가 가능률</span>
                    <strong>{formatPercent(selectedPillar.evaluableRate)}</strong>
                    <ScoreBar value={selectedPillar.evaluableRate} label={`${selectedPillar.label} 평가 가능률`} />
                  </article>
                </div>
                <p>
                  확인 {selectedPillar.resolved ?? "—"} / 전체 {selectedPillar.total ?? "—"} ·
                  서버 FINAL 스냅샷 기준
                </p>
              </section>

              {selectedPillar.key === "IMPROVEMENT_INTENT" && evaluation.goal && (
                <section className="evaluation-drawer__goal" aria-labelledby="drawer-goal-heading">
                  <div className="evaluation-drawer__section-heading">
                    <h3 id="drawer-goal-heading">확인된 개선 목표</h3>
                    <span>{evaluation.goal.status ?? "상태 미확인"}</span>
                  </div>
                  <strong>{evaluation.goal.title ?? "개선 목표"}</strong>
                  <dl>
                    <div>
                      <dt>현재값</dt>
                      <dd>{evaluation.goal.baseline ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>목표값</dt>
                      <dd>{evaluation.goal.target ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>기간</dt>
                      <dd>{evaluation.goal.period ?? "—"}</dd>
                    </div>
                    <div>
                      <dt>측정</dt>
                      <dd>{evaluation.goal.measurementSource ?? "—"}</dd>
                    </div>
                  </dl>
                  <p>{evaluation.goal.context ?? "목표 맥락이 연결되지 않았습니다."}</p>
                </section>
              )}

              <section className="evaluation-drawer__features" aria-labelledby="drawer-feature-heading">
                <div className="evaluation-drawer__section-heading">
                  <h3 id="drawer-feature-heading">이 점수에 기여한 피처</h3>
                  <span>{selectedPillar.contributingFeatureNames.length}개</span>
                </div>
                {selectedLineage.contributingFeatures.length > 0 ? (
                  selectedLineage.contributingFeatures.map((feature) => (
                    <article key={feature.name} data-lineage="contributing">
                      <div>
                        <strong>{feature.name}</strong>
                        <span className="evaluation-lineage-badge">평가 기여</span>
                      </div>
                      <p>{feature.raw ?? "표시 가능한 값 없음"}</p>
                      <small>
                        <span className="state-label" data-state={feature.state.toLowerCase()}>
                          {featureStateLabel(feature.state)}
                        </span>
                        {" · "}{feature.reason ?? `연결 근거 ${feature.evidenceIds.length}개`}
                      </small>
                    </article>
                  ))
                ) : (
                  <p className="evaluation-drawer__empty">
                    서버 FINAL 평가에 점수 기여 피처가 기록되지 않았습니다.
                  </p>
                )}
                {selectedLineage.missingContributingFeatureNames.length > 0 && (
                  <p className="evaluation-lineage-warning" role="status">
                    기여 피처 {selectedLineage.missingContributingFeatureNames.join(", ")}의 FINAL
                    스냅샷 상세를 불러오지 못했습니다. 기여 목록 자체는 평가 원본에 보존되어 있습니다.
                  </p>
                )}
                {selectedLineage.referenceFeatures.length > 0 && (
                  <details className="evaluation-lineage-reference">
                    <summary>
                      같은 영역 참고 피처 {selectedLineage.referenceFeatures.length}개 (점수 미기여)
                    </summary>
                    <div>
                      {selectedLineage.referenceFeatures.map((feature) => (
                        <article key={feature.name} data-lineage="reference">
                          <div>
                            <strong>{feature.name}</strong>
                            <span className="evaluation-lineage-badge evaluation-lineage-badge--reference">
                              참고 · 비기여
                            </span>
                          </div>
                          <p>{feature.raw ?? "표시 가능한 값 없음"}</p>
                          <small>{featureStateLabel(feature.state)} · {feature.reason ?? "참고 피처"}</small>
                        </article>
                      ))}
                    </div>
                  </details>
                )}
              </section>

              <section className="evaluation-drawer__sources" aria-labelledby="drawer-source-heading">
                <div className="evaluation-drawer__section-heading">
                  <h3 id="drawer-source-heading">점수 산정 필수정보</h3>
                  <span>{selectedLineage.contributingInformation.length}개</span>
                </div>
                {selectedLineage.contributingInformation.length > 0 ? (
                  selectedLineage.contributingInformation.map((item) => (
                    <article key={item.infoCode} data-lineage="contributing">
                      <div>
                        <strong>{item.label}</strong>
                        <span className="evaluation-lineage-badge">평가 기여</span>
                      </div>
                      <p>{item.displayValue ?? item.valueStateLabel}</p>
                      <small>
                        <span className="state-label" data-state={item.status.toLowerCase()}>
                          {item.statusLabel}
                        </span>
                        {" · "}{item.verificationLabel ?? "검증상태 없음"} · 근거 {item.evidenceIds.length}개
                        {item.dataQualityScore !== null
                          ? ` · 데이터 품질 ${formatPercent(item.dataQualityScore)}`
                          : ""}
                      </small>
                    </article>
                  ))
                ) : (
                  <p className="evaluation-drawer__empty">
                    이 영역의 점수 산정 필수정보가 FINAL 응답에 연결되지 않았습니다.
                  </p>
                )}
                {selectedLineage.referenceInformation.length > 0 && (
                  <details className="evaluation-lineage-reference">
                    <summary>
                      추가 참고정보 {selectedLineage.referenceInformation.length}개 (점수 미기여)
                    </summary>
                    <div>
                      {selectedLineage.referenceInformation.map((item) => (
                        <article key={item.infoCode} data-lineage="reference">
                          <div>
                            <strong>{item.label}</strong>
                            <span className="evaluation-lineage-badge evaluation-lineage-badge--reference">
                              참고 · 비기여
                            </span>
                          </div>
                          <p>{item.displayValue ?? item.valueStateLabel}</p>
                          <small>{item.infoCode} · {item.statusLabel}</small>
                        </article>
                      ))}
                    </div>
                  </details>
                )}
              </section>

              <section className="evaluation-drawer__evidence" aria-labelledby="drawer-evidence-heading">
                <div className="evaluation-drawer__section-heading">
                  <h3 id="drawer-evidence-heading">점수 기여 인터뷰 근거</h3>
                  <span>{selectedPillar.contributingEvidenceIds.length}개</span>
                </div>
                {selectedLineage.contributingEvidence.length > 0 ? (
                  selectedLineage.contributingEvidence.map((evidence) => (
                    <article key={evidence.id} data-lineage="contributing">
                      <div>
                        <strong>{evidence.kindLabel}</strong>
                        <span className="evaluation-lineage-badge">평가 기여</span>
                      </div>
                      <blockquote>
                        {evidence.linkedTranscript?.text ?? evidence.excerpt ?? "저장된 원문 발췌가 없습니다."}
                      </blockquote>
                      <small>
                        {evidence.source} · {evidence.infoCode} · {formatDateTime(evidence.observedAt)}
                        {evidence.linkedTranscript
                          ? ` · 원문 ${evidence.linkedTranscript.id} 연결`
                          : " · 원문 연결 없음"}
                      </small>
                    </article>
                  ))
                ) : (
                  <p className="evaluation-drawer__empty">
                    서버 FINAL 평가에 점수 기여 근거가 기록되지 않았습니다.
                  </p>
                )}
                {selectedLineage.missingContributingEvidenceIds.length > 0 && (
                  <p className="evaluation-lineage-warning" role="status">
                    기여 근거 ID {selectedLineage.missingContributingEvidenceIds.join(", ")}의 원문
                    맥락을 불러오지 못했습니다. 평가 원본의 기여 ID는 변경하지 않았습니다.
                  </p>
                )}
                {selectedLineage.referenceEvidence.length > 0 && (
                  <details className="evaluation-lineage-reference">
                    <summary>
                      같은 영역 참고 근거 {selectedLineage.referenceEvidence.length}개 (점수 미기여)
                    </summary>
                    <div>
                      {selectedLineage.referenceEvidence.map((evidence) => (
                        <article key={evidence.id} data-lineage="reference">
                          <div>
                            <strong>{evidence.kindLabel}</strong>
                            <span className="evaluation-lineage-badge evaluation-lineage-badge--reference">
                              참고 · 비기여
                            </span>
                          </div>
                          <blockquote>
                            {evidence.linkedTranscript?.text ?? evidence.excerpt ?? "저장된 원문 발췌가 없습니다."}
                          </blockquote>
                          <small>
                            {evidence.source} · {evidence.infoCode}
                            {evidence.linkedTranscript
                              ? ` · 원문 ${evidence.linkedTranscript.id} 연결`
                              : " · 원문 연결 없음"}
                          </small>
                        </article>
                      ))}
                    </div>
                  </details>
                )}
              </section>
            </div>
          </section>
        </div>
      )}

      <div className="evaluation-topline">
        <Link href="/interview-evaluations">
          <ArrowLeft size={16} aria-hidden="true" />
          인터뷰 평가 목록
        </Link>
        <div>
          <Link href={`/interviews/${encodeURIComponent(evaluation.interviewId)}`}>
            원 인터뷰 기록
          </Link>
          <span>
            평가 ID {evaluation.id} · Snapshot v{evaluation.snapshotVersion}
          </span>
        </div>
      </div>

      <header className="evaluation-hero">
        <div className="evaluation-hero__copy">
          <div className="workspace-heading__eyebrow">
            <span className="badge badge--final">FINAL</span>
            <span>인터뷰 보조평가 확정본</span>
          </div>
          <h1>{evaluation.businessName ?? "사업자 인터뷰"} 평가</h1>
          <div className="evaluation-hero__meta">
            <span>
              <UserRound size={15} aria-hidden="true" />
              {evaluation.borrowerName ?? "차주 정보 연결 안 됨"}
            </span>
            <span>
              <Building2 size={15} aria-hidden="true" />
              {evaluation.industry ?? "업종 정보 연결 안 됨"}
            </span>
            <span>
              <CalendarDays size={15} aria-hidden="true" />
              {formatDateTime(evaluation.createdAt)}
            </span>
          </div>
        </div>
        <div
          className="evaluation-hero__seal"
          data-context={evaluation.contextAvailable ? "linked" : "missing"}
          aria-label={evaluation.contextAvailable ? "평가와 FINAL 근거 연결 완료" : "평가는 있으나 FINAL 근거 연결 실패"}
        >
          {evaluation.contextAvailable ? <BadgeCheck size={22} aria-hidden="true" /> : <AlertCircle size={22} aria-hidden="true" />}
          <span>
            {evaluation.contextAvailable ? "FINAL 근거 연결" : "근거 연결 확인 필요"}
            <strong>{evaluation.contextAvailable ? "확인 완료" : "부분 조회"}</strong>
          </span>
        </div>
      </header>

      <section className="evaluation-disclaimer" aria-labelledby="disclaimer-title">
        <ShieldAlert size={21} aria-hidden="true" />
        <div>
          <strong id="disclaimer-title">대출 승인 판단이 아닙니다.</strong>
          <p>
            {evaluation.disclaimer ||
              "인터뷰 보조평가는 상담 답변의 데이터 품질을 정리한 참고 정보이며 금융기관의 승인·거절 판단을 대신하지 않습니다."}
          </p>
        </div>
      </section>

      {!evaluation.contextAvailable && (
        <section className="action-alert" role="alert">
          <AlertCircle size={19} />
          <div>
            <strong>평가 원본은 조회됐지만 FINAL 스냅샷 근거를 연결하지 못했습니다.</strong>
            <p>근거·목표·원천정보를 다시 불러오기 전에는 이 평가를 검토 완료로 취급하지 마세요.</p>
          </div>
        </section>
      )}

      <section className="borrower-summary" aria-labelledby="borrower-summary-heading">
        <div className="report-section-heading">
          <div>
            <p className="panel-kicker">BORROWER & BUSINESS</p>
            <h2 id="borrower-summary-heading">차주·사업 요약</h2>
          </div>
          <span className="report-section-heading__source">
            <Link2 size={14} aria-hidden="true" />
            인터뷰 스냅샷 연결
          </span>
        </div>
        <div className="borrower-summary__grid">
          <dl>
            <div>
              <dt>차주</dt>
              <dd>{evaluation.borrowerName ?? "연결된 정보 없음"}</dd>
            </div>
            <div>
              <dt>사업체</dt>
              <dd>{evaluation.businessName ?? "연결된 정보 없음"}</dd>
            </div>
            <div>
              <dt>업종</dt>
              <dd>{evaluation.industry ?? "연결된 정보 없음"}</dd>
            </div>
          </dl>
          <div className="borrower-summary__narrative">
            <span>확정 인터뷰 요약</span>
            <p>
              {evaluation.transcriptSummary ??
                "현재 평가 API에는 확정 인터뷰 요약이 포함되지 않았습니다. 아래 영역별 요약과 원문 근거를 확인해 주세요."}
            </p>
          </div>
        </div>
      </section>

      <section className="assessment-separation" aria-labelledby="assessment-heading">
        <div className="report-section-heading report-section-heading--bordered">
          <div>
            <p className="panel-kicker">ASSESSMENT SEPARATION</p>
            <h2 id="assessment-heading">신용정보와 인터뷰 보조평가</h2>
          </div>
          <p>서로 다른 출처와 역할을 가진 정보를 합산하지 않습니다.</p>
        </div>

        <div className="assessment-grid">
          <article className="assessment-card assessment-card--cb">
            <div className="assessment-card__heading">
              <div className="assessment-card__icon">
                <FileCheck2 size={21} aria-hidden="true" />
              </div>
              <div>
                <span>외부 공식 정보</span>
                <h3>공식 CB</h3>
              </div>
              <span className="source-chip">별도 영역</span>
            </div>
            {evaluation.officialCb ? (
              <dl className="assessment-values">
                <div>
                  <dt>점수</dt>
                  <dd>{evaluation.officialCb.score ?? "—"}</dd>
                </div>
                <div>
                  <dt>등급</dt>
                  <dd>{evaluation.officialCb.grade ?? "—"}</dd>
                </div>
                <div>
                  <dt>출처</dt>
                  <dd>{evaluation.officialCb.source ?? "—"}</dd>
                </div>
              </dl>
            ) : (
              <div className="assessment-empty">
                <ExternalLink size={18} aria-hidden="true" />
                <div>
                  <strong>연결된 공식 CB 데이터가 없습니다.</strong>
                  <p>이 인터뷰 보조평가에는 공식 신용점수를 추정해 채우지 않습니다.</p>
                </div>
              </div>
            )}
          </article>

          <article className="assessment-card assessment-card--interview">
            <div className="assessment-card__heading">
              <div className="assessment-card__icon">
                <ClipboardCheck size={21} aria-hidden="true" />
              </div>
              <div>
                <span>차주 진술 기반</span>
                <h3>인터뷰 보조평가</h3>
              </div>
              <span className="source-chip source-chip--blue">{evaluation.decisionScope}</span>
            </div>
            <div className="interview-score">
              <div>
                <span>인터뷰 데이터 품질</span>
                <strong>{formatPercent(evaluation.overallScore)}</strong>
              </div>
              <span
                className="level-badge"
                data-level={evaluation.overallLevel.toLowerCase()}
              >
                {evaluation.overallLevelLabel}
              </span>
            </div>
            <ScoreBar value={evaluation.overallScore} label="전체 인터뷰 데이터 품질" />
            <div className="approval-null">
              <Info size={15} aria-hidden="true" />
              승인·거절 및 공식·추정 신용등급은 생성하지 않습니다.
              {evaluation.gradeScope && ` ${evaluation.gradeScope} 범위로만 표시합니다.`}
            </div>
          </article>

          <ModelingScorecardCard scorecard={scorecard} />
        </div>
      </section>

      {evaluation.summarySections.length > 0 && (
        <section className="evidence-section" aria-labelledby="cited-summary-heading">
          <div className="report-section-heading">
            <div>
              <p className="panel-kicker">CITED SUMMARY SECTIONS</p>
              <h2 id="cited-summary-heading">근거 연결 차주 요약</h2>
            </div>
          </div>
          <div className="cited-summary-grid">
            {evaluation.summarySections.map((section, index) => (
              <article key={`${section.kind}-${index}`} data-gap={section.gapStatement ? "true" : "false"}>
                <span>{section.kind}</span>
                <p>{section.text}</p>
                <small>
                  {section.gapStatement
                    ? "명시적 정보 공백"
                    : `근거 ${section.evidenceIds.length}개 연결`}
                </small>
              </article>
            ))}
          </div>
        </section>
      )}

      {evaluation.features.length > 0 && (
        <section className="feature-detail-section" aria-labelledby="feature-detail-heading">
          <div className="report-section-heading">
            <div>
              <p className="panel-kicker">FINAL FEATURE SNAPSHOT</p>
              <h2 id="feature-detail-heading">FINAL 피처 스냅샷</h2>
            </div>
            <div className="feature-detail-actions">
              <p>평가 기여는 서버의 영역별 기여 목록과 일치합니다. 금액·건수는 점수가 아닙니다.</p>
              <button
                type="button"
                className="button button--secondary feature-detail-toggle"
                aria-controls="feature-detail-table"
                aria-expanded={showTechnicalFeatureDetails}
                onClick={() => setShowTechnicalFeatureDetails((visible) => !visible)}
              >
                {showTechnicalFeatureDetails ? "산식 상세 숨기기" : "산식 상세 보기"}
              </button>
            </div>
          </div>
          <div
            id="feature-detail-table"
            className="feature-detail-table"
            role="table"
            aria-label="FINAL 피처 스냅샷"
          >
            <div className="feature-detail-table__head" role="row">
              <span role="columnheader">피쳐</span>
              <span role="columnheader">상태·값</span>
              <span role="columnheader">입력 정보</span>
              <span role="columnheader">
                {showTechnicalFeatureDetails ? "산식·근거" : "근거"}
              </span>
            </div>
            {evaluation.features.map((feature) => {
              const contributes = allContributingFeatureNames.has(feature.name);
              return (
                <div
                  className="feature-detail-table__row"
                  data-lineage={contributes ? "contributing" : "reference"}
                  role="row"
                  key={feature.name}
                >
                  <div role="cell">
                    <strong>{feature.name}</strong>
                    <span
                      className={`evaluation-lineage-badge${contributes ? "" : " evaluation-lineage-badge--reference"}`}
                    >
                      {contributes ? "평가 기여" : "참고 · 비기여"}
                    </span>
                    <small>{feature.domain}</small>
                  </div>
                  <div role="cell">
                    <span className="state-label" data-state={feature.state.toLowerCase()}>{feature.state}</span>
                    <small>
                      {feature.raw ?? "값 없음"}
                      {showTechnicalFeatureDetails && feature.normalized !== null
                        ? ` · normalized ${feature.normalized}`
                        : ""}
                    </small>
                  </div>
                  <div role="cell">
                    <span>{feature.sourceInfoCodes.join(", ") || "—"}</span>
                  </div>
                  <div role="cell">
                    {showTechnicalFeatureDetails ? (
                      <code>{feature.formula ?? "직접 관측"}</code>
                    ) : (
                      <span>근거 {feature.evidenceIds.length}개 연결</span>
                    )}
                    <small>{feature.reason ?? `근거 ${feature.evidenceIds.length}개`}</small>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {evaluation.sourceInformation.length > 0 && (
        <section className="source-information-section" aria-labelledby="source-information-heading">
          <div className="report-section-heading">
            <div>
              <p className="panel-kicker">SOURCE INFORMATION</p>
              <h2 id="source-information-heading">원천 수집정보</h2>
            </div>
            <p>항목 점수·등급은 인터뷰 데이터 품질이며 신용등급이 아닙니다.</p>
          </div>
          <div className="source-information-grid">
            {evaluation.sourceInformation.map((item) => {
              const itemGrade = item.dataQualityGrade;
              return (
                <article key={item.infoCode}>
                  <div>
                    <strong>{item.label}</strong>
                    <span
                      className={`evaluation-lineage-badge${item.required ? "" : " evaluation-lineage-badge--reference"}`}
                    >
                      {item.required ? "평가 기여" : "추가 참고 · 비기여"}
                    </span>
                  </div>
                  <p>{item.displayValue ?? item.valueStateLabel}</p>
                  <small>
                    <span className="state-label" data-state={item.status.toLowerCase()}>{item.statusLabel}</span>
                    {" · "}{item.infoCode} · {item.verificationLabel ?? "검증상태 없음"} · 근거 {item.evidenceIds.length}개
                  </small>
                  {itemGrade ? (
                    <div className="source-information-quality">
                      <div>
                        <span className="level-badge" data-level={itemGrade.toLowerCase()}>
                          {itemGrade} · 데이터 품질
                        </span>
                        <strong>{formatPercent(item.dataQualityScore)}</strong>
                      </div>
                      <small>신용등급 아님 · 출처 {item.dataQualitySource ?? "미확인"}</small>
                      <small>기준시점 {formatDateTime(item.dataQualityAsOf)}</small>
                      {item.dataQualitySummary && <small>{item.dataQualitySummary}</small>}
                    </div>
                  ) : (
                    <small>서버 항목 데이터 품질 평가 없음</small>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      <section className="pillar-evaluation-section" aria-labelledby="pillar-evaluation-heading">
        <div className="report-section-heading">
          <div>
            <p className="panel-kicker">FOUR PILLARS</p>
            <h2 id="pillar-evaluation-heading">4대축 인터뷰 평가</h2>
          </div>
          <p>점수는 상환능력 점수가 아니라 응답 데이터의 충분도입니다.</p>
        </div>

        <div className="evaluation-pillar-grid">
          {evaluation.pillars.map((pillar) => {
            const Icon = pillarIcons[pillar.key];
            return (
              <article className="evaluation-pillar-card" key={pillar.key}>
                <div className="evaluation-pillar-card__top">
                  <div className="evaluation-pillar-card__icon">
                    <Icon size={20} aria-hidden="true" />
                  </div>
                  <span
                    className="level-badge"
                    data-level={pillar.level.toLowerCase()}
                  >
                    {pillar.levelLabel}
                  </span>
                </div>
                <h3>{pillar.label}</h3>
                <p className="evaluation-pillar-card__description">
                  {pillar.shortDescription}
                </p>
                <div className="pillar-score-line">
                  <span>인터뷰 데이터 품질</span>
                  <strong>{formatPercent(pillar.score)}</strong>
                </div>
                <ScoreBar value={pillar.score} label={`${pillar.label} 인터뷰 데이터 품질`} />
                <p className="evaluation-pillar-card__summary">{pillar.summary}</p>
                <div className="evaluation-pillar-card__counts">
                  <span>확인 {pillar.resolved ?? "—"}</span>
                  <span>전체 {pillar.total ?? "—"}</span>
                  <span>평가 가능 {formatPercent(pillar.evaluableRate)}</span>
                  <span>기여 피처 {pillar.contributingFeatureNames.length}</span>
                  <span>기여 근거 {pillar.contributingEvidenceIds.length}</span>
                </div>
                <button
                  type="button"
                  className="evaluation-pillar-card__detail"
                  onClick={(event) => {
                    drawerReturnFocusRef.current = event.currentTarget;
                    setSelectedPillarKey(pillar.key);
                  }}
                  aria-haspopup="dialog"
                >
                  상세 보기 <ChevronDown size={14} aria-hidden="true" />
                </button>
              </article>
            );
          })}
        </div>
      </section>

      <section className="goal-sufficiency-grid" aria-label="목표와 인터뷰 데이터 품질">
        <article className="goal-card">
          <div className="report-section-heading report-section-heading--compact">
            <div>
              <p className="panel-kicker">GOAL SNAPSHOT</p>
              <h2>확인된 개선 목표</h2>
            </div>
            <Target size={20} aria-hidden="true" />
          </div>
          {evaluation.goal ? (
            <>
              <div className="goal-status-line">
                <span>{evaluation.goal.status ?? "상태 미확인"}</span>
                <span>{evaluation.goal.numericStatus ?? "수치 미확인"}</span>
              </div>
              <dl className="goal-values">
              <div>
                <dt>목표</dt>
                <dd>{evaluation.goal.title ?? "—"}</dd>
              </div>
              <div>
                <dt>현재값</dt>
                <dd>{evaluation.goal.baseline ?? "—"}</dd>
              </div>
              <div>
                <dt>목표값</dt>
                <dd>{evaluation.goal.target ?? "—"}</dd>
              </div>
              <div>
                <dt>기간</dt>
                <dd>{evaluation.goal.period ?? "—"}</dd>
              </div>
              <div>
                <dt>단위</dt>
                <dd>{evaluation.goal.unit ?? "—"}</dd>
              </div>
              <div>
                <dt>측정원</dt>
                <dd>{evaluation.goal.measurementSource ?? "—"}</dd>
              </div>
              <div>
                <dt>목표 출처</dt>
                <dd>{evaluation.goal.origin ?? "—"}</dd>
              </div>
              <div>
                <dt>문제·맥락</dt>
                <dd>{evaluation.goal.context ?? "—"}</dd>
              </div>
              {evaluation.goal.behaviorEvent ? (
                <>
                  <div>
                    <dt>행동 이벤트명</dt>
                    <dd>{evaluation.goal.behaviorEvent.eventName ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>측정 윈도우</dt>
                    <dd>{evaluation.goal.behaviorEvent.window ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>행동 지표</dt>
                    <dd>{evaluation.goal.behaviorEvent.metric ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>집계 방식</dt>
                    <dd>{evaluation.goal.behaviorEvent.aggregation ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>행동 데이터 원천</dt>
                    <dd>{evaluation.goal.behaviorEvent.source ?? "—"}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>행동 이벤트</dt>
                  <dd>—</dd>
                </div>
              )}
              </dl>
            </>
          ) : (
            <div className="report-empty">
              <CircleHelp size={20} aria-hidden="true" />
              <div>
                <strong>확정된 목표 데이터가 없습니다.</strong>
                <p>서버 스냅샷에 목표가 포함되면 현재값·목표값·기간을 분리해 표시합니다.</p>
              </div>
            </div>
          )}
        </article>

        <article className="sufficiency-card">
          <div className="report-section-heading report-section-heading--compact">
            <div>
              <p className="panel-kicker">DATA SUFFICIENCY</p>
              <h2>평가 데이터 상태</h2>
            </div>
            <Gauge size={20} aria-hidden="true" />
          </div>
          <div className="sufficiency-score">
            <strong>{formatPercent(evaluation.overallScore)}</strong>
            <span>{evaluation.overallLevelLabel}</span>
          </div>
          <ScoreBar value={evaluation.overallScore} label="평가 인터뷰 데이터 품질" />
          <div className="sufficiency-meta">
            <span>
              <CheckCircle2 size={15} aria-hidden="true" />
              완료 상태 {evaluation.completionStatus}
            </span>
            <span>
              <AlertCircle size={15} aria-hidden="true" />
              미해결 {evaluation.unresolvedItems.length}건
            </span>
          </div>
        </article>
      </section>

      {evaluation.unresolvedItems.length > 0 && (
        <section className="unresolved-section" aria-labelledby="unresolved-heading">
          <div className="report-section-heading report-section-heading--compact">
            <div>
              <p className="panel-kicker">FOLLOW-UP REQUIRED</p>
              <h2 id="unresolved-heading">추가 확인 정보</h2>
            </div>
            <span>{evaluation.unresolvedItems.length}건</span>
          </div>
          <div className="unresolved-list">
            {evaluation.unresolvedItems.map((item) => (
              <article key={item.infoCode}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.infoCode}</span>
                </div>
                <span className="priority-chip">{item.priority}</span>
                <span className="state-label" data-state={item.status.toLowerCase()}>
                  {item.statusLabel}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="evidence-section" aria-labelledby="evidence-heading">
        <div className="report-section-heading">
          <div>
            <p className="panel-kicker">SOURCE EVIDENCE</p>
            <h2 id="evidence-heading">평가 근거 원문</h2>
          </div>
          <span className="report-section-heading__source">
            <FileText size={14} aria-hidden="true" />
            {evaluation.evidence.length}개 근거
          </span>
        </div>

        {evaluation.evidence.length > 0 ? (
          <div className="evidence-list">
            {evaluation.evidence.map((evidence, index) => (
              <details className="evidence-item" key={evidence.id}>
                <summary>
                  <span className="evidence-item__index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="evidence-item__heading">
                    <strong>{evidence.kindLabel}</strong>
                    <small>
                      {evidence.infoCode || "공통 근거"} · {evidence.source}
                    </small>
                  </span>
                  <span className="evidence-item__action">
                    {evidence.linkedTranscript ? "발화 상세 보기" : "원문 보기"}
                  </span>
                  <ChevronDown size={17} aria-hidden="true" />
                </summary>
                <div className="evidence-item__body">
                  <blockquote>
                    {evidence.excerpt ?? "저장된 원문 발췌가 없습니다."}
                  </blockquote>
                  <dl>
                    <div>
                      <dt>근거 ID</dt>
                      <dd>{evidence.id}</dd>
                    </div>
                    <div>
                      <dt>확인 시각</dt>
                      <dd>{formatDateTime(evidence.observedAt)}</dd>
                    </div>
                    <div>
                      <dt>출처</dt>
                      <dd>{evidence.source}</dd>
                    </div>
                    <div>
                      <dt>발화 세그먼트</dt>
                      <dd>{evidence.transcriptSegmentId ?? "연결 없음"}</dd>
                    </div>
                  </dl>
                  {evidence.linkedTranscript && (
                    <section
                      className="evidence-transcript-detail"
                      aria-label={`연결 발화 ${evidence.linkedTranscript.id}`}
                    >
                      <div className="evidence-transcript-detail__heading">
                        <strong>연결된 FINAL 발화</strong>
                        <span>
                          revision {evidence.linkedTranscript.revision} · {evidence.linkedTranscript.speaker}
                        </span>
                      </div>
                      <dl className="evidence-transcript-detail__metadata">
                        <div>
                          <dt>시작</dt>
                          <dd>
                            {evidence.linkedTranscript.startMs === null
                              ? "기록 없음"
                              : `${evidence.linkedTranscript.startMs}ms`}
                          </dd>
                        </div>
                        <div>
                          <dt>종료</dt>
                          <dd>
                            {evidence.linkedTranscript.endMs === null
                              ? "기록 없음"
                              : `${evidence.linkedTranscript.endMs}ms`}
                          </dd>
                        </div>
                        <div>
                          <dt>STT 제공자</dt>
                          <dd>{evidence.linkedTranscript.sttProvider ?? "기록 없음"}</dd>
                        </div>
                        <div>
                          <dt>STT 신뢰도</dt>
                          <dd>
                            {evidence.linkedTranscript.sttConfidence === null
                              ? "기록 없음"
                              : `${Math.round(evidence.linkedTranscript.sttConfidence * 100)}%`}
                          </dd>
                        </div>
                      </dl>
                      <div className="evidence-transcript-detail__texts">
                        <div>
                          <span>원본 인식문</span>
                          <p>{evidence.linkedTranscript.rawText}</p>
                        </div>
                        <div>
                          <span>교정문</span>
                          <p>{evidence.linkedTranscript.correctedText ?? "교정 없음"}</p>
                        </div>
                        <div>
                          <span>평가 적용문</span>
                          <p>{evidence.linkedTranscript.text}</p>
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              </details>
            ))}
          </div>
        ) : (
          <div className="report-empty report-empty--bordered">
            <FileText size={20} aria-hidden="true" />
            <div>
              <strong>연결된 근거 원문을 불러오지 못했습니다.</strong>
              <p>평가 자체는 유지되지만, 근거 검토 전에는 별도의 사실 확인이 필요합니다.</p>
            </div>
          </div>
        )}
      </section>

      <footer className="evaluation-footer">
        <BarChart3 size={18} aria-hidden="true" />
        <div>
          <strong>동행금융AI 인터뷰 보조평가</strong>
          <p>
            본 결과는 차주의 인터뷰 응답과 연결된 근거의 데이터 품질만
            나타냅니다. 공식 CB 및 금융기관의 독립적인 심사 절차와 분리해
            사용하세요.
          </p>
        </div>
        <span className="badge badge--final">FINAL</span>
      </footer>
    </main>
  );
}
