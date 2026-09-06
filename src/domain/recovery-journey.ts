import type { BorrowerImprovementSelection } from "./improvement-candidate-selection";
export const RECOVERY_MISSIONS = [
  { id: 1, title: "현재상황 증빙 남기기", description: "최근 매출 자료, 예약·수주 자료, 거래 정산 내역 등 준비한 자료의 이름과 기간을 기록합니다.", exampleTitle: "합성 매출 자료 준비", exampleNote: "시연용 3개월 매출표의 항목과 집계 기간을 점검했습니다. 이 기록은 자료 준비에 대한 자기보고이며 실제 금융기관 데이터가 아닙니다." },
  { id: 2, title: "개선 행동 실행", description: "선택한 비용 조정·광고 변경·반복고객 캠페인 등을 언제 어떻게 실행했는지 기록합니다.", exampleTitle: "합성 광고비 조정 기록", exampleNote: "가상 사례의 광고 설정 변경 절차를 정리했습니다. 실제 비용 절감이나 매출 개선 성과를 확인한 기록은 아닙니다." },
  { id: 3, title: "다음 금융상담 준비", description: "실행기록, 개선 전·후에 비교할 항목, 필요한 증빙 묶음을 정리합니다.", exampleTitle: "합성 상담 준비 기록", exampleNote: "가상 사례의 준비자료와 실행기록을 묶고, 다음 상담에서 확인할 항목을 정리했습니다. 금융기관에 전달되거나 심사에 반영된 자료는 아닙니다." },
] as const;
export type ReviewStatus = "PENDING" | "NEEDS_INFORMATION" | "REVIEWED";
export interface RecoveryEvidence {
  id: string; interviewId: string; finalSnapshotId: string; missionId: number;
  title: string; note: string; observedOn: string; createdAt: string;
  kind: "SELF_REPORTED"; eventType: "NEW_EVIDENCE"; contentHash: string;
}
export interface RecoveryState {
  interviewId: string; finalSnapshotId: string; selection: BorrowerImprovementSelection | null;
  evidence: RecoveryEvidence[]; completedMissionIds: number[]; revision: number;
  review: { status: ReviewStatus; revision: number; note: string; reviewedAt: string | null };
}
