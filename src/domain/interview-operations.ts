export type InterviewLifecycle = "ACTIVE" | "COMPLETE" | "INCOMPLETE";
export type OperationsFilter = "ALL" | InterviewLifecycle | "ATTENTION";

export interface InterviewOperationsItem {
  id: string;
  borrowerName: string;
  businessName: string;
  industry: string;
  lifecycleStatus: InterviewLifecycle;
  currentQuestionCode: string | null;
  currentQuestionLabel: string | null;
  updatedAt: string;
  unresolvedRequiredCount: number;
  conflictCount: number;
  borrowerAnswerCount: number;
  processingFailed: boolean;
  evaluationId: string | null;
}

export interface InterviewOperationsQuery {
  q?: string;
  status?: OperationsFilter;
  limit?: number;
  offset?: number;
}

export interface InterviewOperationsResult {
  items: InterviewOperationsItem[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  summary: { total: number; active: number; attention: number; complete: number; incomplete: number };
}

export function interviewNextAction(item: InterviewOperationsItem) {
  if (item.lifecycleStatus !== "ACTIVE") {
    return {
      label: item.evaluationId ? "근거 검토" : "종료 기록 확인",
      href: item.evaluationId ? `/interview-evaluations/${encodeURIComponent(item.evaluationId)}` : `/interviews/${encodeURIComponent(item.id)}`,
      tone: item.lifecycleStatus === "COMPLETE" ? "complete" : "quiet",
    };
  }
  return {
    label: item.processingFailed ? "저장 답변 다시 확인" : item.conflictCount > 0 ? "다른 내용 확인" : item.currentQuestionCode === null ? "답변·종료 검토" : "인터뷰 이어보기",
    href: `/interviews/${encodeURIComponent(item.id)}`,
    tone: item.processingFailed || item.conflictCount > 0 ? "attention" : "active",
  };
}
