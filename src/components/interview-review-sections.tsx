import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ConsultationPackage } from "@/domain/consultation-package";
import { SIGNAL_LABELS } from "@/domain/data-review";
import { formatInformationValue } from "./api-adapter";
import styles from "@/app/institution-review.module.css";

export function InterviewReviewOverview({ data }: { data: ConsultationPackage }) {
  const { review, recovery } = data;
  const fields = [["monthly_average_sales", "월평균 매출"], ["fixed_operating_costs", "월 고정 운영비"], ["repeat_customer_share", "반복고객 비중"], ["improvement_plan", "사업 개선 계획"]];
  return <><div className={styles.overviewHero}><h2>사업 현황</h2><p className={styles.sectionLead}>{review.businessName} · 인터뷰에서 확인한 내용입니다.</p><dl className={styles.facts}>{fields.map(([code, label]) => { const item = review.canonical.find((entry) => entry.infoCode === code); return <div key={code}><dt>{label}</dt><dd>{formatInformationValue(item?.selected?.value) ?? "정보 부족"}<small>{item?.selected ? "인터뷰 진술" : "미확인"}</small></dd></div>; })}</dl></div>
    <h3>개선가능성 신호</h3><p className={styles.muted}>신호별 입력과 원문은 ‘변수·근거’에서 확인할 수 있습니다.</p><div className={styles.signals}>{Object.entries(SIGNAL_LABELS).map(([name, label]) => { const item = review.features.find((feature) => feature.name === name); return <article key={name}><h3>{label}</h3><span className={styles.badge}>{item?.interpretation ?? "정보 부족"}</span><p>{item?.reason}</p></article>; })}</div>
    <p className={styles.boundary}>확인할 정보 {review.metrics.needed}개 · 실행 기록 {recovery.evidence.length}개. 알 수 없는 값은 추정하지 않으며, 신호를 신용점수나 승인 확률로 환산하지 않습니다.</p>
  </>;
}

export function InterviewReviewPlan({ data }: { data: ConsultationPackage }) {
  const { review, recovery } = data;
  const choice = recovery.selection?.choice;
  return <><h2>계획과 실행 기록</h2><p className={styles.sectionLead}>사업자가 선택한 계획과 이후 남긴 기록을 확인합니다.</p><section className={styles.section}><h3>선택한 개선 계획</h3><p className={styles.savedNote}>{choice && choice !== "SKIP" ? choice.title : choice === "SKIP" ? "사업자가 계획 선택을 보류했습니다." : "아직 선택한 개선 계획이 없습니다."}</p>{recovery.selection && <p className={styles.muted}>{new Date(recovery.selection.selectedAt).toLocaleString("ko-KR")} 선택</p>}</section><section className={styles.section}><h3>실행 기록 · {recovery.evidence.length}개</h3>{recovery.evidence.length ? <ol className={styles.records}>{recovery.evidence.map((record) => <li key={record.id}><small>기록 {record.missionId} · {record.observedOn} · 자기보고</small><h3>{record.title}</h3><p>{record.note}</p><details><summary>원문 기록 ID</summary><code>{record.id}</code></details></li>)}</ol> : <p className={styles.muted}>아직 남긴 기록이 없습니다. 실행 기록 없이도 현재 확인한 내용으로 검토자료를 만들 수 있습니다.</p>}<Link className={styles.actionLink} href={`/recovery/${review.interviewId}`}>계획 선택·실행 기록 남기기<ArrowRight size={14} /></Link><p className={styles.boundary}>실행 기록은 인터뷰 종료 원본과 별도로 보관합니다. 향후 재평가 시 새로운 Evidence로 활용될 수 있습니다.</p></section></>;
}
