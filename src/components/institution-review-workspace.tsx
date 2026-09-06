"use client";

import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, FileText } from "lucide-react";
import styles from "@/app/institution-review.module.css";

export const REVIEW_SECTIONS = [
  { id: "overview", label: "검토 요약" },
  { id: "evidence", label: "변수·근거" },
  { id: "plan", label: "계획·기록" },
  { id: "opinion", label: "담당자 의견" },
  { id: "export", label: "자료 내보내기" },
] as const;
export type ReviewSection = typeof REVIEW_SECTIONS[number]["id"];

/** Keeps every panel mounted so switching sections cannot discard a draft. */
export function InstitutionReviewWorkspace({ panels, title, context, status, metrics, actions, notice, initialSection = "overview" }: {
  panels: Record<ReviewSection, ReactNode>; title: string; context: string; status: string;
  metrics: Array<{ label: string; value: string | number }>; actions: ReactNode; notice?: ReactNode; initialSection?: ReviewSection;
}) {
  const query = useSearchParams();
  const unique = useId().replace(/:/g, "");
  const workspaceRef = useRef<HTMLDivElement>(null);
  const active = REVIEW_SECTIONS.find((item) => item.id === query.get("section"))?.id ?? initialSection;
  const index = REVIEW_SECTIONS.findIndex((item) => item.id === active);
  function select(section: ReviewSection) {
    const url = new URL(window.location.href);
    url.searchParams.set("section", section);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    if (workspaceRef.current && workspaceRef.current.getBoundingClientRect().top < 0) {
      workspaceRef.current.scrollIntoView({ block: "start" });
    }
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>, current: number) {
    const next = event.key === "ArrowRight" ? (current + 1) % REVIEW_SECTIONS.length : event.key === "ArrowLeft" ? (current + REVIEW_SECTIONS.length - 1) % REVIEW_SECTIONS.length : event.key === "Home" ? 0 : event.key === "End" ? REVIEW_SECTIONS.length - 1 : null;
    if (next === null) return;
    event.preventDefault(); select(REVIEW_SECTIONS[next].id);
    document.getElementById(`${unique}-${REVIEW_SECTIONS[next].id}-tab`)?.focus();
  }
  return <div className={styles.workspace} ref={workspaceRef}>
    <div className={styles.tabs} role="tablist" aria-label="금융기관 검토자료 작업">
      {REVIEW_SECTIONS.map((item, ordinal) => <button type="button" role="tab" id={`${unique}-${item.id}-tab`} aria-controls={`${unique}-${item.id}-panel`} aria-selected={item.id === active} tabIndex={item.id === active ? 0 : -1} onClick={() => select(item.id)} onKeyDown={(event) => keyDown(event, ordinal)} key={item.id}><span aria-hidden="true">{String(ordinal + 1).padStart(2, "0")}</span>{item.label}</button>)}
    </div>
    <div className={styles.workspaceBody}>
      <div className={styles.mainPanel}>
        {REVIEW_SECTIONS.map((item) => <section key={item.id} role="tabpanel" id={`${unique}-${item.id}-panel`} aria-labelledby={`${unique}-${item.id}-tab`} hidden={active !== item.id} tabIndex={0} className={styles.panel}>{panels[item.id]}</section>)}
        <nav className={styles.nextStep} aria-label="검토자료 순서 이동"><button type="button" disabled={index === 0} onClick={() => select(REVIEW_SECTIONS[index - 1].id)}><ArrowLeft size={14} /> 이전</button><span>{index + 1} / {REVIEW_SECTIONS.length}</span>{index < REVIEW_SECTIONS.length - 1 ? <button type="button" onClick={() => select(REVIEW_SECTIONS[index + 1].id)}>{REVIEW_SECTIONS[index + 1].label}<ArrowRight size={14} /></button> : <button type="button" onClick={() => select("overview")}>요약 다시 보기<ArrowRight size={14} /></button>}</nav>
      </div>
      <aside className={styles.summary} aria-label="현재 검토자료">
        <div className={styles.summaryHeading}><FileText size={18} /><span>현재 검토자료</span></div><h2>{title}</h2><p className={styles.muted}>{context}</p><span className={styles.badge}>{status}</span>
        <dl className={styles.statList}>{metrics.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
        <div className={styles.exportActions}>{actions}</div>{notice && <div className={styles.saveNotice} role="status">{notice}</div>}
        <button className={styles.quietButton} type="button" onClick={() => select(active === "opinion" ? "export" : "opinion")}>{active === "opinion" ? "내보내기 준비" : "검토 의견 작성"}<ArrowRight size={14} /></button>
      </aside>
    </div>
  </div>;
}
