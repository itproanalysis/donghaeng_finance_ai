import {
  CHECK_DOCUMENTS,
  proposalsFor,
  type CompanionCase,
} from "./case-model.ts";
export const INSTITUTIONS = [
  {
    id: "semas",
    name: "소상공인시장진흥공단",
    type: "지원사업·정책자금 상담",
    url: "https://www.semas.or.kr/",
    description:
      "현재 공고와 자금 목적을 확인하고 필요한 상담 절차를 알아봅니다.",
  },
  {
    id: "koreg",
    name: "지역신용보증재단",
    type: "사업장 소재지의 보증 상담",
    url: "https://www.koreg.or.kr/",
    description:
      "신용보증재단중앙회에서 지역 재단과 공식 상담 경로를 확인합니다.",
  },
  {
    id: "kodit",
    name: "신용보증기금",
    type: "기업 보증·경영지원 상담",
    url: "https://www.kodit.or.kr/",
    description:
      "보증·경영지원 제도를 살펴보고 담당 기관과 상담 범위를 검토합니다.",
  },
];
export function preparationReady(item: CompanionCase) {
  return (
    !!item.completedAt &&
    proposalsFor(item).some((p) => p.id === item.review.proposalId) &&
    item.review.reviewed &&
    !!item.review.dueDate &&
    CHECK_DOCUMENTS.every((d) => item.review.documents.includes(d))
  );
}
export function consultationText(item: CompanionCase) {
  const institution = INSTITUTIONS.find(
    (i) => i.id === item.review.institution,
  );
  const proposal = proposalsFor(item).find(
    (p) => p.id === item.review.proposalId,
  );
  if (!preparationReady(item) || !institution || !proposal)
    throw new Error("개선안·점검일·준비자료와 상담 기관을 먼저 확인해 주세요.");
  return [
    "동행금융 · 금융기관 상담 준비자료",
    "담당자 검토 초안 / 기관 미전송",
    `사업체: ${item.businessName}`,
    `사장님: ${item.borrowerName || "호칭 미입력"}`,
    `인터뷰 완료: ${item.completedAt}`,
    `기록 ID: ${item.id}`,
    "",
    "1. 확인한 질문과 답변",
    ...item.answers.flatMap((a) => [
      `질문: ${a.questionText}`,
      `답변: ${a.answerText}`,
      `확인: ${a.acceptedAt} · 수정 ${a.revision}회`,
      "",
    ]),
    "2. 검토할 개선안",
    proposal.title,
    `근거: ${proposal.source}`,
    proposal.reason,
    `실행 후보: ${proposal.action}`,
    `담당: ${item.review.owner}`,
    `점검일: ${item.review.dueDate}`,
    "실제 실행·달성 성과는 아직 확인하지 않았습니다.",
    "",
    "3. 준비자료 점검",
    ...CHECK_DOCUMENTS.map((d) => `- ${d}`),
    "원본 자료는 별도로 준비합니다. 이 체크리스트는 증빙 원본을 대체하지 않습니다.",
    "",
    "4. 상담 검토 기관",
    institution.name,
    institution.url,
    "",
    "이 자료는 금융기관에 전송되거나 접수된 것이 아닙니다.",
    "대출 승인·금리·한도·신용등급을 판단하지 않습니다. 기관의 독립적인 상담·심사가 필요합니다.",
  ].join("\n");
}
