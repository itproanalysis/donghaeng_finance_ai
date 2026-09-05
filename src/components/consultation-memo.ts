import type { EvidenceView, FinalInterviewView, InformationItemView } from "./api-adapter";

/** Display-only grouping. Never turn a declined or unknown answer into a fact. */
export function groupConsultationInformation(items: readonly InformationItemView[]) {
  return {
    confirmed: items.filter((item) => item.status === "CONFIRMED"),
    deferred: items.filter((item) => item.status === "REFUSED" || item.status === "UNAVAILABLE"),
    notApplicable: items.filter((item) => item.status === "NOT_APPLICABLE"),
    followUp: items.filter((item) => !["CONFIRMED", "REFUSED", "UNAVAILABLE", "NOT_APPLICABLE"].includes(item.status)),
  };
}

export function linkedConsultationEvidence(item: InformationItemView, evidence: readonly EvidenceView[]) {
  const ids = new Set(item.evidenceIds);
  return evidence.filter((entry) => ids.has(entry.id) && entry.infoCode === item.infoCode);
}

function quote(value: string) {
  return value.split(/\r?\n/).map((line) => `    > ${line}`).join("\n");
}

/** A portable rendering of an existing FINAL record, not a new AI assessment. */
export function buildConsultationMemo(snapshot: FinalInterviewView): string {
  const groups = groupConsultationInformation(snapshot.informationItems);
  function describe(item: InformationItemView): string[] {
    const evidence = linkedConsultationEvidence(item, snapshot.evidence);
    const missing = item.evidenceIds.filter((id) => !evidence.some((entry) => entry.id === id));
    return [
      `- ${item.label} · ${item.statusLabel}`,
      `  기록된 값: ${item.displayValue ?? item.valueStateLabel}`,
      `  확인 상태: ${item.verificationLabel ?? "별도 검증 여부 확인 필요"}`,
      ...evidence.flatMap((entry) => [
        `  연결 근거 [${entry.id}] · ${entry.kindLabel} · 출처: ${entry.source}`,
        ...(entry.observedAt ? [`  관측 시점: ${entry.observedAt}`] : []),
        quote(entry.excerpt ?? entry.linkedTranscript?.text ?? "이 기록에는 원문이 포함되지 않았습니다."),
      ]),
      ...(evidence.length ? [] : ["  연결된 근거 없음 — 증빙이 확인되었다는 의미가 아닙니다."]),
      ...(missing.length ? [`  원문을 확인할 수 없는 근거: ${missing.join(", ")}`] : []),
    ];
  }
  function section(title: string, items: readonly InformationItemView[], empty: string) {
    return [title, ...(items.length ? items.flatMap(describe) : [empty]), ""];
  }
  return [
    "동행금융 · 금융 상담 준비 메모",
    "인터뷰 기록 사본 · 금융기관 미전송",
    `사업체: ${snapshot.businessName}`,
    `호칭: ${snapshot.borrowerName}`,
    `업종: ${snapshot.industry}`,
    `기록 확정: ${snapshot.finalizedAt ?? "시점 미확인"} · 버전 ${snapshot.version}`,
    `인터뷰: ${snapshot.interviewId} · 원본 기록: ${snapshot.id}`,
    `종료 상태: ${snapshot.completionStatus === "COMPLETE" ? "완료" : "미확인 항목을 남기고 종료"}`,
    "",
    "읽기 전에",
    "사장님의 자기진술과 연결된 자료를 정리한 기록입니다. 공식 증빙을 대체하지 않습니다.",
    "확인 상태는 인터뷰 수집 상태이며, 재무 사실에 대한 독립 검증이나 신용평가가 아닙니다.",
    "답변 거절·모름·해당 없음은 0원이나 부정적인 평가로 바꾸지 않았습니다.",
    "대출 승인·거절·한도·금리·신용등급을 판단하지 않으며 금융기관에 자동 전송하지 않습니다.",
    "",
    ...section("1. 인터뷰에서 확인한 내용", groups.confirmed, "확인한 항목이 없습니다."),
    ...section("2. 아직 확인이 필요한 내용", groups.followUp, "추가 확인 대상으로 남은 항목이 없습니다."),
    "3. 답변을 보류한 내용",
    "모르거나 답하기 어려워 종결한 항목입니다. 원하지 않으면 다시 답하지 않아도 됩니다.",
    ...(groups.deferred.length ? groups.deferred.flatMap(describe) : ["답변을 보류한 항목이 없습니다."]),
    "",
    ...section("4. 해당하지 않는 내용", groups.notApplicable, "해당 없음으로 기록한 항목이 없습니다."),
    "5. 다음 상담에 가져갈 때",
    "이 메모와 실제 매출·비용 등 확인 가능한 자료를 함께 검토해 주세요.",
    "필요한 증빙과 상담 가능 여부는 상담 기관에서 별도로 확인해야 합니다.",
    "파일에는 사업 정보와 답변 원문이 포함됩니다. 공유할 대상과 저장 위치를 직접 확인해 주세요.",
  ].join("\n");
}
