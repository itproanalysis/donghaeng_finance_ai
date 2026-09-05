export const CONSULTATION_DOCUMENTS = ["사업자등록 정보 확인", "매출·비용 증빙 확인", "기존 채무·상환 내역 확인", "자금 목적·필요 금액 정리"] as const;
export const CONSULTATION_OWNERS = ["사장님 + 담당 상담사", "사장님 + 경영지원 담당자"] as const;
export const CONSULTATION_PERIODS = ["2주 후 점검", "4주 후 점검", "상담 시 일정 협의"] as const;
export const CONSULTATION_INSTITUTIONS = ["semas", "koreg", "kodit"] as const;

export interface ConsultationDraftData {
  proposalId: string | null;
  owner: string;
  period: string;
  documents: string[];
  reviewed: boolean;
  institutionId: string | null;
}

export interface ConsultationDraftRecord {
  interviewId: string;
  revision: number;
  updatedAt: string | null;
  data: ConsultationDraftData;
}

export function emptyConsultationDraft(): ConsultationDraftData {
  return { proposalId: null, owner: CONSULTATION_OWNERS[0], period: CONSULTATION_PERIODS[0], documents: [], reviewed: false, institutionId: null };
}
