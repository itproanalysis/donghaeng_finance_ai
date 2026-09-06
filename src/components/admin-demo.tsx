"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ModelingBundle, ModelingCase } from "@/server/modeling-demo";
import { ModelingWorkflow } from "./modeling-workflow";
import styles from "@/app/institution-review.module.css";

/** Restored financial-review desk; all case values come from the existing server pipeline. */
export function AdminDemo({ selectedCase, cases, reevaluation, modelVersion }: {
  selectedCase: ModelingCase; cases: ModelingCase[]; reevaluation: ModelingBundle["reevaluation"]; modelVersion: string;
}) {
  const router = useRouter();
  return <main id="main-content" className={styles.page}>
    <header className={styles.header}><div><nav className={styles.breadcrumb} aria-label="현재 위치"><Link href="/">동행금융</Link><span>/</span><span>금융기관 검토</span></nav><h1>금융기관 검토자료</h1><p>사업 현황과 근거를 확인하고, 담당자 의견을 담아 검토서를 만듭니다.</p></div><nav className={styles.headerLinks}><Link href="/review">내 인터뷰 기록</Link><Link href={`/modeling?case=${selectedCase.caseId}&tab=impact`}>평가 과정 살펴보기</Link></nav></header>
    <div className={styles.contextBar}><label>합성 사례<select aria-label="검토 사례" value={selectedCase.caseId} onChange={(event) => { const query = new URLSearchParams(window.location.search); query.set("case", event.target.value); router.push(`/demo/admin?${query}`, { scroll: false }); }}>{cases.map((item) => <option value={item.caseId} key={item.caseId}>{item.ordinal}. {item.title}</option>)}</select></label>{[reevaluation.beforeCase, reevaluation.afterCase].includes(selectedCase.caseId) ? <nav className={styles.periods} aria-label="자료 시점"><Link href={`/demo/admin?case=${reevaluation.beforeCase}`} aria-current={selectedCase.caseId === reevaluation.beforeCase ? "page" : undefined}>최초 분석</Link><Link href={`/demo/admin?case=${reevaluation.afterCase}&section=plan`} aria-current={selectedCase.caseId === reevaluation.afterCase ? "page" : undefined}>6개월 후</Link></nav> : <span className={styles.sourceLabel}>Competition Demo / Synthetic Data</span>}</div>
    <ModelingWorkflow key={selectedCase.caseId} view="report" selectedCase={selectedCase} cases={cases} reevaluation={reevaluation} modelVersion={modelVersion} onNavigate={(tab, caseId) => router.push(`/modeling?case=${caseId ?? selectedCase.caseId}&tab=${tab}`)} />
  </main>;
}
