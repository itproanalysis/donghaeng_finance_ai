"use client";

import { CheckCircle2, LoaderCircle, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";

import {
  borrowerCompletionCommand,
  borrowerCompletionDisposition,
} from "@/components/borrower-completion";
import { buildImprovementCandidates } from "@/components/borrower-immersive-prompts";
import {
  adaptInterviewSnapshot,
  ApiRequestError,
  authenticatedFetch,
  createClientCommandId,
  type FinalInterviewView,
  type LiveInterviewView,
  readApiEnvelope,
} from "@/components/api-adapter";

interface BorrowerCompletionReviewProps {
  interviewId: string;
  live: LiveInterviewView;
  answerCount: number;
  onCompleted: (snapshot: FinalInterviewView) => void;
  onRefresh: () => Promise<void>;
}

const REVIEWABLE_STATUSES = new Set([
  "CONFIRMED",
  "UNAVAILABLE",
  "REFUSED",
  "NOT_APPLICABLE",
]);

export function BorrowerCompletionReview({
  interviewId,
  live,
  answerCount,
  onCompleted,
  onRefresh,
}: BorrowerCompletionReviewProps) {
  const [confirmationVersion, setConfirmationVersion] = useState<number | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const [completionBlockers, setCompletionBlockers] = useState<string[]>([]);
  const [candidateSelection, setCandidateSelection] = useState<{
    id: string;
    version: number;
  } | null>(null);
  const reviewItems = useMemo(
    () => live.informationItems.filter((item) => REVIEWABLE_STATUSES.has(item.status)),
    [live.informationItems],
  );
  const completionDisposition = useMemo(
    () => borrowerCompletionDisposition(live.informationItems),
    [live.informationItems],
  );
  const incompleteCompletion = completionDisposition.mode === "FORCE_INCOMPLETE";
  const improvementCandidates = useMemo(
    () => buildImprovementCandidates({
      informationItems: live.informationItems,
      goal: live.goal,
    }),
    [live.goal, live.informationItems],
  );
  const selectedCandidateId = candidateSelection?.version === live.version
    ? candidateSelection.id
    : null;
  const candidateChoiceMade = selectedCandidateId === "SKIP" ||
    improvementCandidates.some((candidate) => candidate.id === selectedCandidateId);
  const selectedCandidate = improvementCandidates.find(
    (candidate) => candidate.id === selectedCandidateId,
  );
  const improvementChoice = selectedCandidateId === "SKIP"
    ? "SKIP" as const
    : selectedCandidate
      ? {
          id: selectedCandidate.id,
          title: selectedCandidate.title,
          origin: selectedCandidate.origin,
          sourceInfoCodes: [...selectedCandidate.sourceInfoCodes],
          evidenceIds: [...selectedCandidate.evidenceIds],
        }
      : null;
  const confirmed = confirmationVersion === live.version && candidateChoiceMade;

  async function completeInterview() {
    if (!confirmed || completing) return;
    setCompleting(true);
    setCompletionError(null);
    setCompletionBlockers([]);
    try {
      const response = await authenticatedFetch(
        `/api/interviews/${encodeURIComponent(interviewId)}/complete`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            borrowerCompletionCommand(
              live.version,
              createClientCommandId("borrower-complete"),
              completionDisposition.mode,
              improvementChoice,
            ),
          ),
        },
      );
      const data = await readApiEnvelope(response);
      const finalSnapshot = adaptInterviewSnapshot(data);
      if (finalSnapshot.snapshotType !== "FINAL") {
        throw new Error("완료된 인터뷰 기록을 확인하지 못했습니다.");
      }
      onCompleted(finalSnapshot);
    } catch (caught) {
      if (caught instanceof ApiRequestError) {
        setCompletionBlockers(caught.blockers);
      }
      setCompletionError(
        caught instanceof Error
          ? caught.message
          : "인터뷰를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setCompleting(false);
    }
  }

  async function refreshCompletionState() {
    setCompletionError(null);
    setCompletionBlockers([]);
    try {
      await onRefresh();
    } catch (caught) {
      setCompletionError(
        caught instanceof Error
          ? caught.message
          : "최신 인터뷰 상태를 불러오지 못했습니다.",
      );
    }
  }

  function reviewAnswers() {
    document.querySelector<HTMLElement>(".borrower-review")?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  }

  return (
    <section className="borrower-completion-review" aria-labelledby="borrower-completion-title">
      <div className="borrower-completion-review__heading">
        <CheckCircle2 size={26} aria-hidden="true" />
        <div>
          <span>준비한 질문을 모두 마쳤어요</span>
          <h2 id="borrower-completion-title">마지막으로 이야기 내용을 확인해 주세요</h2>
          <p>확인한 뒤 마치면 지금까지의 답변으로 사업 이야기와 개선 방향을 정리합니다.</p>
        </div>
      </div>

      <div className="borrower-completion-review__counts" aria-label="인터뷰 기록 요약">
        <div><strong>{answerCount}</strong><span>답변한 질문</span></div>
        <div><strong>{reviewItems.length}</strong><span>정리된 항목</span></div>
        <div>
          <strong>{live.resolvedRequired ?? 0}/{live.totalRequired ?? 0}</strong>
          <span>필수 항목 확인</span>
        </div>
      </div>

      {reviewItems.length > 0 ? (
        <ul className="borrower-completion-review__items">
          {reviewItems.map((item) => (
            <li key={item.infoCode}>
              <span>{item.label}</span>
              <strong>{item.displayValue ?? item.statusLabel}</strong>
            </li>
          ))}
        </ul>
      ) : (
        <p className="borrower-completion-review__empty">
          오른쪽의 질문·답변 기록을 보고 말씀하신 내용이 맞는지 확인해 주세요.
        </p>
      )}

      {incompleteCompletion && (
        <section className="borrower-completion-review__terminal" role="note">
          <strong>확인하기 어렵거나 답변하지 않은 항목이 있어요</strong>
          <p>
            아래 항목은 사장님이 말씀하신 상태 그대로 기록하고 인터뷰를 마칩니다.
            이 종료 기록으로는 인터뷰 데이터 평가를 만들지 않습니다.
          </p>
          <ul>
            {completionDisposition.terminalRequiredItems.map((item) => (
              <li key={item.infoCode}>
                <span>{item.label}</span>
                <strong>{item.status === "REFUSED" ? "답변하지 않음" : "확인하기 어려움"}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="borrower-completion-candidates" aria-labelledby="borrower-completion-candidates-title">
        <div className="borrower-completion-candidates__heading">
          <span>마치기 전 한 번 더 생각해 보기</span>
          <h3 id="borrower-completion-candidates-title">앞으로 살펴보고 싶은 개선 후보가 있나요?</h3>
          <p>
            확인된 답변과 인터뷰 질문 범위에서만 만든 참고용 제안이에요.
            여기서 고른 내용은 확정 목표·평가·신용판단으로 저장되지 않습니다.
          </p>
        </div>
        <div className="borrower-completion-candidates__list" role="radiogroup" aria-label="개선 후보 선택">
          {improvementCandidates.map((candidate, index) => (
            <button
              type="button"
              role="radio"
              aria-checked={selectedCandidateId === candidate.id}
              data-selected={selectedCandidateId === candidate.id}
              key={candidate.id}
              disabled={completing}
              onClick={() => {
                setCandidateSelection({ id: candidate.id, version: live.version });
                setConfirmationVersion(null);
              }}
            >
              <span>{String.fromCharCode(65 + index)}</span>
              <strong>{candidate.title}</strong>
              <p>{candidate.description}</p>
              <small>{candidate.sourceLabel} · 아직 제안 단계</small>
            </button>
          ))}
        </div>
        <button
          type="button"
          role="radio"
          aria-checked={selectedCandidateId === "SKIP"}
          className="borrower-completion-candidates__skip"
          data-selected={selectedCandidateId === "SKIP"}
          disabled={completing}
          onClick={() => {
            setCandidateSelection({ id: "SKIP", version: live.version });
            setConfirmationVersion(null);
          }}
        >
          지금은 개선 후보를 고르지 않을게요
        </button>
      </section>

      <label className="borrower-completion-review__confirmation">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={completing || !candidateChoiceMade}
          onChange={(event) => {
            setConfirmationVersion(event.target.checked ? live.version : null);
            setCompletionError(null);
            setCompletionBlockers([]);
          }}
        />
        <span>
          <strong>
            {incompleteCompletion
              ? "확인 가능한 범위의 답변과 미확인 항목을 함께 확인했습니다."
              : "지금까지의 질문과 답변을 확인했습니다."}
          </strong>
          <small>
            {!candidateChoiceMade
              ? "위에서 개선 후보 하나 또는 ‘지금은 고르지 않음’을 먼저 선택해 주세요."
              : incompleteCompletion
              ? "미확인 항목은 임의 값으로 채우지 않고 평가 제외 상태로 안전하게 종료합니다."
              : "완료 시 서버가 빠진 필수 내용과 처리 중인 답변을 한 번 더 확인합니다."}
          </small>
        </span>
      </label>

      {(completionError || completionBlockers.length > 0) && (
        <div className="borrower-completion-review__error" role="alert">
          <strong>{completionError ?? "아직 완료할 수 없는 항목이 있습니다."}</strong>
          {completionBlockers.length > 0 && (
            <ul>
              {completionBlockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
            </ul>
          )}
          <p>답변 기록을 다시 확인하거나 최신 상태를 불러온 뒤 완료를 다시 시도해 주세요.</p>
        </div>
      )}

      <div className="borrower-completion-review__actions">
        <button type="button" className="borrower-secondary-button" onClick={reviewAnswers} disabled={completing}>
          답변 다시 보기
        </button>
        {completionError && (
          <button type="button" className="borrower-secondary-button" onClick={() => void refreshCompletionState()} disabled={completing}>
            <RefreshCw size={15} aria-hidden="true" /> 최신 상태 확인
          </button>
        )}
        <button type="button" className="borrower-primary-button" onClick={() => void completeInterview()} disabled={!confirmed || completing}>
          {completing ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : <CheckCircle2 size={17} aria-hidden="true" />}
          {completing
            ? "완료 조건 확인 중"
            : incompleteCompletion
              ? "확인 가능한 범위로 인터뷰 마치기"
              : "확인하고 인터뷰 마치기"}
        </button>
      </div>
    </section>
  );
}
