"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ModelingBundle, ModelingCase } from "@/server/modeling-demo";
import { ModelingWorkflow } from "./modeling-workflow";
import styles from "@/app/data-engine.module.css";

/** Restored financial-review desk; all case values come from the existing server pipeline. */
export function AdminDemo({ selectedCase, cases, reevaluation, modelVersion }: {
  selectedCase: ModelingCase; cases: ModelingCase[]; reevaluation: ModelingBundle["reevaluation"]; modelVersion: string;
}) {
  const router = useRouter();
  return <main id="main-content" className={styles.page}>
    <header><p className={styles.eyebrow}>금융기관 검토실 · Competition Demo / Synthetic Data</p><h1>금융기관 검토자료</h1><p>사업 현황과 평가 근거를 검토하고, 수행자료와 담당자 의견을 담아 최종 검토서를 만듭니다.</p></header>
    <nav className={styles.secondaryLinks}><Link href="/review">내 인터뷰 기록으로 검토자료 만들기</Link><Link href={`/modeling?case=${selectedCase.caseId}&tab=impact`}>변수와 평가 과정</Link><Link href="/about">서비스 소개</Link></nav>
    <section className={styles.review}><label>검토 사례<select aria-label="검토 사례" value={selectedCase.caseId} onChange={(event) => router.push(`/demo/admin?case=${encodeURIComponent(event.target.value)}`)}>{cases.map((item) => <option value={item.caseId} key={item.caseId}>{item.ordinal}. {item.title}</option>)}</select></label><p className={styles.small}>아래는 서버에서 산출한 합성 거래자료 사례입니다. 직접 진행한 인터뷰의 검토자료는 ‘내 인터뷰 기록’에서 선택할 수 있습니다.</p></section>
    {[reevaluation.beforeCase, reevaluation.afterCase].includes(selectedCase.caseId) && <nav className={styles.actions}><Link href={`/demo/admin?case=${reevaluation.beforeCase}`}>최초 검토자료</Link><Link href={`/demo/admin?case=${reevaluation.afterCase}`}>6개월 후 검토자료</Link></nav>}
    <ModelingWorkflow key={selectedCase.caseId} view="report" selectedCase={selectedCase} cases={cases} reevaluation={reevaluation} modelVersion={modelVersion} onNavigate={(tab, caseId) => router.push(`/modeling?case=${caseId ?? selectedCase.caseId}&tab=${tab}`)} />
  </main>;
}
