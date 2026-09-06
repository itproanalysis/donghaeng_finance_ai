"use client";

import { useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { ArrowRight, Download, ExternalLink, Printer } from "lucide-react";
import { authenticatedFetch, formatInformationValue, readApiEnvelope } from "./api-adapter";
import { useConsultationDraft } from "./use-consultation-draft";
import { CONSULTATION_DOCUMENTS, CONSULTATION_OWNERS, CONSULTATION_PERIODS } from "@/domain/consultation-draft";
import { SIGNAL_LABELS } from "@/domain/data-review";
import { DEV_V1_ALL_INFORMATION_CATALOG } from "@/domain/information-catalog";
import type { ConsultationPackage } from "@/domain/consultation-package";
import styles from "@/app/data-engine.module.css";

const informationName = (code: string) => DEV_V1_ALL_INFORMATION_CATALOG.find((item) => item.infoCode === code)?.label ?? code;

export function InstitutionConsultation({ interviewId }: { interviewId: string }) {
  const [data, setData] = useState<ConsultationPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const read = useCallback(async (signal?: AbortSignal) => await readApiEnvelope(await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/consultation-package`, { cache: "no-store", signal })) as ConsultationPackage, [interviewId]);
  useEffect(() => {
    const controller = new AbortController();
    read(controller.signal).then((value) => { if (!controller.signal.aborted) setData(value); }).catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [read]);
  if (!data) return <><h1>금융기관 상담 준비</h1><p role={error ? "alert" : "status"}>{error ?? "상담에 필요한 기록을 불러오는 중입니다."}</p><Link href={`/review/${interviewId}`}>분석 결과로 돌아가기</Link>{error && <button className={styles.textButton} onClick={() => void read().then((value) => { setData(value); setError(null); }).catch((error: Error) => setError(error.message))}>다시 불러오기</button>}</>;
  return <ConsultationEditor initial={data} read={read} />;
}

function ConsultationEditor({ initial, read }: { initial: ConsultationPackage; read: () => Promise<ConsultationPackage> }) {
  const [data, setData] = useState(initial);
  const persistence = useConsultationDraft(data.canEditDraft ? data.review.interviewId : undefined);
  const { draft, setDraft } = persistence;
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { review, recovery } = data;
  const institution = data.institutions.find((item) => item.id === draft.institutionId);
  const unavailable = exporting || persistence.loading || persistence.saving || !persistence.loaded;
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
        const anchor = document.createElement("a"); anchor.href = url; anchor.download = `동행금융_상담준비서_v${current.review.version}.json`; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice("원문과 변수별 근거를 포함한 상담 자료를 내려받았습니다.");
      }
    } catch (error) { setError(error instanceof Error ? error.message : "자료를 만들지 못했습니다. 다시 시도해 주세요."); }
    finally { setExporting(false); }
  }
  return <>
    <header><p className={styles.eyebrow}>금융기관 상담{data.environment === "SYNTHETIC_DEMO" && " · Competition Demo / Synthetic Data"}</p><h1>분석 결과를<br />금융기관 상담으로 이어갑니다.</h1><p>{review.businessName}의 사업 현황, 근거와 실행 기록을 상담 준비서로 묶습니다.</p><nav className={styles.secondaryLinks}><Link href={`/review/${review.interviewId}`}>분석 결과</Link><Link href={`/recovery/${review.interviewId}`}>개선 계획·실행 기록</Link></nav></header>
    <ol className={styles.judgeProgress} aria-label="금융기관 상담 절차"><li>1. 결과와 준비자료 확인</li><li>2. 상담할 기관 선택</li><li>3. 준비서 저장</li><li>4. 공식 창구에서 상담</li></ol>
    <section className={styles.review}><h2>상담에 가져갈 내용</h2><div className={styles.handoffGrid}><article><h3>사업 현황과 근거</h3><p>확인된 정보 {review.metrics.confirmed}개 · 원문 근거 {review.metrics.evidence}개</p><p>생성된 변수 {review.metrics.computed}개 · 정보 부족 {review.metrics.missing}개</p></article><article><h3>선택한 계획과 실행</h3><p>{recovery.selection?.choice && recovery.selection.choice !== "SKIP" ? recovery.selection.choice.title : "아직 선택한 개선 계획이 없습니다."}</p><p>실행 기록 {recovery.evidence.length}개</p></article></div><p className={styles.small}>부족한 정보와 준비하지 않은 자료도 그대로 포함합니다. 상담을 위해 모든 항목을 완료할 필요는 없습니다.</p></section>
    <section className={styles.review}><h2>상담할 기관</h2><p>필요한 상담 경로를 직접 선택하세요. 상품 적합성이나 지원 자격을 판정한 목록은 아닙니다.</p><div className={styles.institutionCards}>{data.institutions.map((item) => <article key={item.id} data-selected={draft.institutionId === item.id}><small>{item.category}</small><h3>{item.name}</h3><p>{item.description}</p>{data.canEditDraft && <label><input type="radio" name="consultation-institution" checked={draft.institutionId === item.id} disabled={unavailable} onChange={() => setDraft((current) => ({ ...current, institutionId: item.id }))} /> {item.name} 선택</label>}<a href={item.url} target="_blank" rel="noopener noreferrer">공식 상담 안내 <ExternalLink size={14} /></a></article>)}</div><p className={styles.small}>거래 은행에 상담할 때도 이 준비서와 원본 자료를 함께 가져갈 수 있습니다.</p></section>
    {data.canEditDraft && <section className={`${styles.review} ${styles.preparationForm}`}><h2>상담 전 준비자료</h2><p>확인한 자료만 표시하세요. 자료를 업로드하거나 진위를 확인하는 절차는 아닙니다.</p><fieldset disabled={unavailable}><legend className="sr-only">상담 준비 내용</legend><div className={styles.handoffGrid}><div>{CONSULTATION_DOCUMENTS.map((item) => <label key={item} className={styles.checkline}><input type="checkbox" checked={draft.documents.includes(item)} onChange={(event) => setDraft((current) => ({ ...current, documents: CONSULTATION_DOCUMENTS.filter((value) => value === item ? event.target.checked : current.documents.includes(value)) }))} />{item}</label>)}</div><div><label>함께 점검할 담당자<select value={draft.owner} onChange={(event) => setDraft((current) => ({ ...current, owner: event.target.value }))}>{CONSULTATION_OWNERS.map((item) => <option key={item}>{item}</option>)}</select></label><label>다음 점검 시점<select value={draft.period} onChange={(event) => setDraft((current) => ({ ...current, period: event.target.value }))}>{CONSULTATION_PERIODS.map((item) => <option key={item}>{item}</option>)}</select></label><label className={styles.checkline}><input type="checkbox" checked={draft.reviewed} onChange={(event) => setDraft((current) => ({ ...current, reviewed: event.target.checked }))} />상담할 내용과 준비 상태를 확인했습니다.</label></div></div></fieldset><div className={styles.actions}><button disabled={unavailable || !persistence.dirty} onClick={() => void savePreparation()}>{persistence.saving ? "저장 중…" : "상담 준비 내용 저장"}</button><button disabled={exporting || persistence.loading || persistence.saving} onClick={() => void persistence.reload()}>저장된 내용 불러오기</button></div><p className={styles.small} role="status">{persistence.dirty ? "저장하지 않은 변경 내용이 있습니다." : persistence.updatedAt ? `저장됨 · ${new Date(persistence.updatedAt).toLocaleString("ko-KR")}` : "아직 저장한 상담 준비 내용이 없습니다."}</p>{persistence.error && <p role="alert">{persistence.error}</p>}</section>}
    <section className={styles.handoff}><h2>준비서를 챙겨 상담 창구로</h2><p>{institution ? `${institution.name}의 공식 안내에서 상담 경로와 필요한 서류를 확인하세요.` : "준비서를 내려받아 상담할 기관의 공식 창구에서 절차를 확인하세요."}</p><div className={styles.actions}><button disabled={unavailable || persistence.dirty} onClick={() => void exportPackage("print")}><Printer size={16} />상담 준비서 인쇄·PDF</button><button disabled={unavailable || persistence.dirty} onClick={() => void exportPackage("json")}><Download size={16} />근거 포함 자료 받기</button>{institution && <a href={institution.url} target="_blank" rel="noopener noreferrer">{institution.name} 상담 안내 <ArrowRight size={15} /></a>}</div><p className={styles.small}>원문·구조화 정보·100개 변수와 근거·개선 계획·실행 기록이 자료에 포함됩니다. 기관에 자동 전송되거나 상담이 접수되지는 않습니다.</p>{notice && <p role="status">{notice}</p>}{error && <p role="alert">{error}</p>}</section>
    <details className={styles.review}><summary>상담 준비서에 담기는 내용</summary><ConsultationPrint data={data} preview /></details>
    <section id="institution-package-print" className={styles.printOnly}><ConsultationPrint data={data} /></section>
  </>;
}

function ConsultationPrint({ data, preview = false }: { data: ConsultationPackage; preview?: boolean }) {
  const { review, recovery, draft } = data;
  const institution = data.institutions.find((item) => item.id === draft?.data.institutionId);
  const choice = recovery.selection?.choice;
  return <div className={styles.packageDocument}>
    <h2>동행금융 · 금융기관 상담 준비서</h2><p>{review.businessName} · {review.borrowerName}<br />{data.environment === "SYNTHETIC_DEMO" && "합성 사례 / "}기관 미전송 · {data.preparedAt}<br />상담 기관: {institution?.name ?? "미선택"}</p>
    <h3>1. 사업 현황</h3><table><thead><tr><th>항목</th><th>확인된 내용</th><th>상태</th></tr></thead><tbody>{review.canonical.map((item) => <tr key={item.infoCode}><td>{informationName(item.infoCode)}</td><td>{formatInformationValue(item.selected?.value) ?? "정보 부족"}</td><td>{item.status}</td></tr>)}</tbody></table>
    <h3>2. 분석 결과와 확인할 정보</h3><p>변수 {review.metrics.computed}개 생성 / {review.metrics.missing}개 정보 부족 / {review.metrics.notCalculable}개 계산 불가</p>{Object.entries(SIGNAL_LABELS).map(([name, label]) => { const feature = review.features.find((item) => item.name === name); return <p key={name}><strong>{label}</strong> · {feature?.interpretation ?? "정보 부족"}<br />{feature?.reason}</p>; })}
    <h3>3. 변수와 근거</h3><table><thead><tr><th>변수</th><th>서버 값</th><th>Evidence</th></tr></thead><tbody>{review.features.filter((item) => item.state === "COMPUTED").map((item) => <tr key={item.name}><td>{item.name}</td><td>{String(item.value)}</td><td>{item.evidenceIds.join(", ")}</td></tr>)}</tbody></table><p>정보 부족: {review.features.filter((item) => item.state !== "COMPUTED").map((item) => `${item.name} (${item.state})`).join(", ")}</p>
    <h3>4. 원문 근거</h3>{review.evidence.map((item) => <article key={item.id}><strong>{informationName(item.infoCode)} · {item.kind}</strong><p>{item.originalText ?? item.excerpt ?? "원문 없음"}</p><small>{item.id}</small></article>)}
    <h3>5. 선택한 계획과 실행 기록</h3><p>{choice && choice !== "SKIP" ? choice.title : "선택한 계획 없음"}</p>{recovery.evidence.length ? recovery.evidence.map((item) => <article key={item.id}><strong>{item.title} · {item.observedOn}</strong><p>{item.note}</p><small>{item.id} · {item.kind}</small></article>) : <p>아직 실행 기록이 없습니다.</p>}
    <h3>6. 상담 준비 상태</h3>{CONSULTATION_DOCUMENTS.map((item) => <p key={item}>{draft?.data.documents.includes(item) ? "확인함" : "미확인"} · {item}</p>)}<p>담당: {draft?.data.owner ?? "미정"} / 점검: {draft?.data.period ?? "미정"}<br />준비 내용 검토: {draft?.data.reviewed ? "확인함" : "미확인"} · 초안 버전 {draft?.revision ?? "없음"}</p>
    <p>종료 기록 {review.finalHash}<br />자료 형식 {data.schemaVersion} / 변수 정의 {review.schemaVersion}</p><p>진술과 자기보고 실행 기록을 정리한 자료입니다. 원본 증빙은 별도로 준비하며 대출 승인·거절, 신용등급을 산정하지 않습니다.</p>{preview && <p>저장 후 내려받을 때 최신 실행 기록과 상담 준비 내용을 다시 확인합니다.</p>}
  </div>;
}
