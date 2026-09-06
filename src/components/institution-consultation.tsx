"use client";

import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ArrowRight, Download, ExternalLink, Printer } from "lucide-react";
import { authenticatedFetch, formatInformationValue, readApiEnvelope } from "./api-adapter";
import { useConsultationDraft } from "./use-consultation-draft";
import { CONSULTATION_DOCUMENTS, CONSULTATION_OWNERS, CONSULTATION_PERIODS } from "@/domain/consultation-draft";
import { RecoveryJourney } from "./recovery-journey";
import { DataReviewContent } from "./data-review-panel";
import { SIGNAL_LABELS } from "@/domain/data-review";
import { DEV_V1_ALL_INFORMATION_CATALOG } from "@/domain/information-catalog";
import type { ConsultationPackage } from "@/domain/consultation-package";
import styles from "@/app/data-engine.module.css";
import reviewStyles from "@/app/institution-review.module.css";
import { InstitutionReviewWorkspace } from "./institution-review-workspace";
import { InterviewReviewOverview, InterviewReviewPlan } from "./interview-review-sections";

const informationName = (code: string) => DEV_V1_ALL_INFORMATION_CATALOG.find((item) => item.infoCode === code)?.label ?? code;

export function InstitutionConsultation({ interviewId, reviewFirst = false }: { interviewId: string; reviewFirst?: boolean }) {
  const [data, setData] = useState<ConsultationPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(async (signal?: AbortSignal) => await readApiEnvelope(await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/consultation-package`, { cache: "no-store", signal })) as ConsultationPackage, [interviewId]);
  useEffect(() => {
    const controller = new AbortController();
    read(controller.signal).then((value) => { if (!controller.signal.aborted) setData(value); }).catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [read]);
  if (!data) return <><h1>{reviewFirst ? "금융기관 검토자료" : "금융기관 상담 준비"}</h1><p role={error ? "alert" : "status"}>{error ?? "상담에 필요한 기록을 불러오는 중입니다."}</p><Link href={`/review/${interviewId}`}>분석 결과로 돌아가기</Link>{error && <button className={styles.textButton} onClick={() => void read().then((value) => { setData(value); setError(null); }).catch((error: Error) => setError(error.message))}>다시 불러오기</button>}</>;
  return <ConsultationEditor initial={data} read={read} reviewFirst={reviewFirst} />;
}

function ConsultationEditor({ initial, read, reviewFirst }: { initial: ConsultationPackage; read: () => Promise<ConsultationPackage>; reviewFirst: boolean }) {
  const [data, setData] = useState(initial);
  const persistence = useConsultationDraft(data.canEditDraft ? data.review.interviewId : undefined);
  const { draft, setDraft } = persistence;
  const [exporting, setExporting] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!reviewDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [reviewDirty]);
  const { review, recovery } = data;
  const institution = data.institutions.find((item) => item.id === draft.institutionId);
  const unavailable = exporting || persistence.loading || persistence.saving || !persistence.loaded || reviewDirty;
  async function savePreparation() {
    await persistence.save();
    try { setData(await read()); }
    catch { setError("준비 내용의 최신 상태를 불러오지 못했습니다. 다시 불러오기를 눌러주세요."); }
  }
  async function exportPackage(format: "json" | "print") {
    if (unavailable || persistence.dirty) return;
    setExporting(true); setError(null); setNotice("");
    try {
      const current = await read();
      flushSync(() => setData(current));
      if (format === "print") { window.print(); setNotice("인쇄 창에서 PDF로 저장할 수 있습니다."); }
      else {
        const url = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: "application/json;charset=utf-8" }));
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `동행금융_금융기관검토자료_v${current.review.version}.json`; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("원문, 변수별 근거와 담당자 의견을 포함한 검토자료를 내려받았습니다.");
      }
    } catch (error) { setError(error instanceof Error ? error.message : "자료를 만들지 못했습니다. 다시 시도해 주세요."); }
    finally { setExporting(false); }
  }
  const exportPanel = <>
    <h2>자료 내보내기</h2><p className={reviewStyles.sectionLead}>상담할 기관과 준비 상태를 정리해 현재 검토자료에 함께 담습니다.</p>
    <section className={reviewStyles.section}><h3>상담할 기관</h3><p className={reviewStyles.muted}>상품 적합성·지원 자격을 판단한 목록은 아닙니다. 거래 은행 상담에도 이 자료를 사용할 수 있습니다.</p><div className={styles.institutionCards}>{data.institutions.map((item) => <article key={item.id} data-selected={draft.institutionId === item.id}><small>{item.category}</small><h3>{item.name}</h3><p>{item.description}</p>{data.canEditDraft && <label><input type="radio" name="consultation-institution" checked={draft.institutionId === item.id} disabled={unavailable} onChange={() => setDraft((current) => ({ ...current, institutionId: item.id }))} />{item.name} 선택</label>}<a href={item.url} target="_blank" rel="noopener noreferrer">공식 상담 안내<ExternalLink size={13} /></a></article>)}</div></section>
    {data.canEditDraft && <section className={`${reviewStyles.section} ${styles.preparationForm}`}><h3>상담 전 준비자료</h3><p className={reviewStyles.muted}>확인한 자료만 표시하세요. 모든 항목을 완료해야 하는 것은 아닙니다.</p><fieldset disabled={unavailable}><legend className="sr-only">상담 준비 내용</legend>{CONSULTATION_DOCUMENTS.map((item) => <label key={item} className={styles.checkline}><input type="checkbox" checked={draft.documents.includes(item)} onChange={(event) => setDraft((current) => ({ ...current, documents: CONSULTATION_DOCUMENTS.filter((value) => value === item ? event.target.checked : current.documents.includes(value)) }))} />{item}</label>)}<div className={styles.handoffGrid}><label>함께 점검할 담당자<select value={draft.owner} onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))}>{CONSULTATION_OWNERS.map((item) => <option key={item}>{item}</option>)}</select></label><label>다음 점검 시점<select value={draft.period} onChange={(event) => setDraft((current) => ({ ...current, period: event.target.value }))}>{CONSULTATION_PERIODS.map((item) => <option key={item}>{item}</option>)}</select></label></div><label className={styles.checkline}><input type="checkbox" checked={draft.reviewed} onChange={(event) => setDraft((current) => ({ ...current, reviewed: event.target.checked }))} />상담할 내용과 준비 상태를 확인했습니다.</label></fieldset><div className={styles.actions}><button disabled={unavailable || !persistence.dirty} onClick={() => void savePreparation()}>{persistence.saving ? "저장 중…" : "상담 준비 내용 저장"}</button><button disabled={exporting || persistence.loading || persistence.saving} onClick={() => void persistence.reload()}>저장된 내용 불러오기</button></div>{persistence.error && <p role="alert">{persistence.error}</p>}</section>}
    <section className={reviewStyles.section}><h3>검토자료에 포함되는 내용</h3><p>사업 현황, 100개 변수와 원문 근거, 미확인 항목, 선택한 계획·실행 기록, 담당자 의견과 상담 준비 상태를 포함합니다.</p><p className={reviewStyles.muted}>‘최종 검토자료 받기’는 JSON 파일을 만듭니다. 문서는 ‘검토자료 인쇄·PDF’에서 저장할 수 있습니다.</p>{institution && <a href={institution.url} className={reviewStyles.actionLink} target="_blank" rel="noopener noreferrer">{institution.name} 상담 안내<ArrowRight size={14} /></a>}<p className={reviewStyles.boundary}>직접 내려받아 상담에 활용하는 자료입니다. 기관에 자동 전송하거나 상담을 접수하지 않습니다.</p></section>
  </>;
  return <>
    <header className={reviewStyles.header}><div><nav className={reviewStyles.breadcrumb} aria-label="현재 위치"><Link href="/review">내 인터뷰 기록</Link><span>/</span><span>금융기관 검토</span></nav><h1>금융기관 검토자료</h1><p>사업 현황과 근거를 확인하고, 담당자 의견을 담아 검토서를 만듭니다.</p></div><nav className={reviewStyles.headerLinks}><Link href={`/review/${review.interviewId}`}>분석 결과</Link><Link href={`/recovery/${review.interviewId}`}>개선 계획·실행 기록</Link></nav></header>
    <div className={reviewStyles.contextBar}><div><strong>{review.businessName}</strong><span className={reviewStyles.muted}> · 인터뷰 종료 기록 v{review.version}</span></div><span className={reviewStyles.sourceLabel}>{data.environment === "SYNTHETIC_DEMO" ? "Competition Demo / Synthetic Data" : "인터뷰 확인 자료"}</span></div>
    <InstitutionReviewWorkspace title={review.businessName} context={`인터뷰 종료 기록 v${review.version}`} status={{ PENDING: "검토 전", NEEDS_INFORMATION: "추가 확인 필요", REVIEWED: "검토 완료" }[recovery.review.status]} initialSection={reviewFirst ? "overview" : "export"}
      metrics={[{ label: "생성된 변수", value: `${review.metrics.computed} / ${review.metrics.totalFeatures}` }, { label: "원문 근거", value: `${review.metrics.evidence}개` }, { label: "실행 기록", value: `${recovery.evidence.length}개` }]}
      actions={<><button disabled={unavailable || persistence.dirty} onClick={() => void exportPackage("json")}><Download size={15} />최종 검토자료 받기</button><button disabled={unavailable || persistence.dirty} onClick={() => void exportPackage("print")}><Printer size={15} />검토자료 인쇄·PDF</button></>}
      notice={reviewDirty ? "작성 중인 담당자 의견을 먼저 저장하세요." : persistence.dirty ? "변경한 상담 준비 내용을 먼저 저장하세요." : notice || (persistence.updatedAt ? "저장한 상담 준비 내용을 함께 포함합니다." : "현재 확인한 내용으로 자료를 받을 수 있습니다.")}
      panels={{
        overview: <InterviewReviewOverview data={data} />,
        evidence: <div className={`${styles.review} ${reviewStyles.embeddedAnalysis}`}><DataReviewContent review={review} embedded /></div>,
        plan: <InterviewReviewPlan data={data} />,
        opinion: data.canEditDraft ? <RecoveryJourney interviewId={review.interviewId} operator reviewOnly onChanged={(recovery) => setData((current) => ({ ...current, recovery }))} onReviewDirtyChange={setReviewDirty} /> : <><h2>담당자 의견</h2><p className={reviewStyles.savedNote}>{recovery.review.note || "아직 작성한 검토 의견이 없습니다."}</p><p className={reviewStyles.muted}>담당자가 검토한 내용이 여기에 표시됩니다.</p></>,
        export: exportPanel,
      }} />
    {error && <p role="alert">{error}</p>}
    <section id="institution-package-print" className={styles.printOnly}><ConsultationPrint data={data} /></section>
  </>;

}

function ConsultationPrint({ data, preview = false }: { data: ConsultationPackage; preview?: boolean }) {
  const { review, recovery, draft } = data;
  const institution = data.institutions.find((item) => item.id === draft?.data.institutionId);
  const choice = recovery.selection?.choice;
  return <div className={styles.packageDocument}>
    <h2>동행금융 · 금융기관 검토자료</h2><p>{review.businessName} · {review.borrowerName}<br />{data.environment === "SYNTHETIC_DEMO" && "합성 사례 / "}기관 미전송 · {data.preparedAt}<br />상담 기관: {institution?.name ?? "미선택"}</p>
    <h3>1. 사업 현황</h3><table><thead><tr><th>항목</th><th>확인된 내용</th><th>상태</th></tr></thead><tbody>{review.canonical.map((item) => <tr key={item.infoCode}><td>{informationName(item.infoCode)}</td><td>{formatInformationValue(item.selected?.value) ?? "정보 부족"}</td><td>{item.status}</td></tr>)}</tbody></table>
    <h3>2. 분석 결과와 확인할 정보</h3><p>변수 {review.metrics.computed}개 생성 / {review.metrics.missing}개 정보 부족 / {review.metrics.notCalculable}개 계산 불가</p>{Object.entries(SIGNAL_LABELS).map(([name, label]) => { const feature = review.features.find((item) => item.name === name); return <p key={name}><strong>{label}</strong> · {feature?.interpretation ?? "정보 부족"}<br />{feature?.reason}</p>; })}
    <h3>3. 변수와 근거</h3><table><thead><tr><th>변수</th><th>서버 값</th><th>Evidence</th></tr></thead><tbody>{review.features.filter((item) => item.state === "COMPUTED").map((item) => <tr key={item.name}><td>{item.name}</td><td>{String(item.value)}</td><td>{item.evidenceIds.join(", ")}</td></tr>)}</tbody></table><p>정보 부족: {review.features.filter((item) => item.state !== "COMPUTED").map((item) => `${item.name} (${item.state})`).join(", ")}</p>
    <h3>4. 원문 근거</h3>{review.evidence.map((item) => <article key={item.id}><strong>{informationName(item.infoCode)} · {item.kind}</strong><p>{item.originalText ?? item.excerpt ?? "원문 없음"}</p><small>{item.id}</small></article>)}
    <h3>5. 선택한 계획과 실행 기록</h3><p>{choice && choice !== "SKIP" ? choice.title : "선택한 계획 없음"}</p>{recovery.evidence.length ? recovery.evidence.map((item) => <article key={item.id}><strong>{item.title} · {item.observedOn}</strong><p>{item.note}</p><small>{item.id} · {item.kind}</small></article>) : <p>아직 실행 기록이 없습니다.</p>}
    <h3>6. 담당자 검토 의견</h3><p>{{ PENDING: "검토 전", NEEDS_INFORMATION: "추가 확인 필요", REVIEWED: "검토 완료" }[recovery.review.status]} · 기록 {recovery.review.revision}</p><p>{recovery.review.note || "아직 작성한 검토 의견이 없습니다."}</p>
    <h3>7. 상담 준비 상태</h3>{CONSULTATION_DOCUMENTS.map((item) => <p key={item}>{draft?.data.documents.includes(item) ? "확인함" : "미확인"} · {item}</p>)}<p>담당: {draft?.data.owner ?? "미정"} / 점검: {draft?.data.period ?? "미정"}<br />준비 내용 검토: {draft?.data.reviewed ? "확인함" : "미확인"} · 초안 버전 {draft?.revision ?? "없음"}</p>
    <p>종료 기록 {review.finalHash}<br />자료 형식 {data.schemaVersion} / 변수 정의 {review.schemaVersion}</p><p>진술과 자기보고 실행 기록을 정리한 자료입니다. 원본 증빙은 별도로 준비하며 대출 승인·거절, 신용등급을 산정하지 않습니다.</p>{preview && <p>저장 후 내려받을 때 최신 실행 기록과 상담 준비 내용을 다시 확인합니다.</p>}
  </div>;
}
