"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { authenticatedFetch, readApiEnvelope } from "./api-adapter";
import { DataReviewPanel } from "./data-review-panel";
import { InstitutionHandoff } from "./institution-handoff";
import { RecoveryJourney } from "./recovery-journey";
import type { DataReview } from "@/domain/data-review";
import type { InterviewOperationsItem } from "@/domain/interview-operations";
import { SIGNAL_LABELS } from "@/domain/data-review";
import styles from "@/app/data-engine.module.css";

interface ReviewRow extends InterviewOperationsItem {
  metrics: DataReview["metrics"]; signals: Array<{ name: string; interpretation: string }>;
  planSelected: "PENDING" | "SKIPPED" | "SELECTED"; reviewStatus: "PENDING" | "NEEDS_INFORMATION" | "REVIEWED";
}
const statusLabel = { ACTIVE: "인터뷰 중", COMPLETE: "전체 인터뷰 완료", INCOMPLETE: "미확인 포함 종료" };
export function DataReviewList() {
  const [result, setResult] = useState<{ items: ReviewRow[]; total: number; hasMore: boolean } | null>(null);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      authenticatedFetch(`/api/data-reviews?${new URLSearchParams({ q, offset: String(offset) })}`, { cache: "no-store" }).then(readApiEnvelope)
        .then((data) => { if (active) { setResult(data as typeof result); setError(null); } }).catch((error: Error) => { if (active) setError(error.message); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [q, offset, refresh]);
  return <section className={styles.review}><div className={styles.filters}><label>사업자·사업체 검색<input type="search" value={q} maxLength={100} placeholder="이름 또는 사업체" onChange={(event) => { setQ(event.target.value); setOffset(0); }} /></label><button className={styles.textButton} onClick={() => setRefresh((value) => value + 1)}>목록 새로고침</button></div>{error && <p role="alert">{error}</p>}{!result && !error && <p role="status">검토 목록을 불러오는 중입니다.</p>}{result && <><p className={styles.small}>이 브라우저에 연결된 기록 {result.total}건 · 근거 확보는 원문이 연결된 항목 수, 변수 생성은 값을 구할 수 있는 항목 수입니다.</p><div className={styles.tableWrap}><table className={styles.reviewTable}><thead><tr>{["사업자", "인터뷰 상태", "근거 확보", "변수 생성", "정보 부족", "개선가능성 근거", "선택한 계획", "검토 상태", "금융기관 상담"].map((label) => <th key={label}>{label}</th>)}</tr></thead><tbody>{result.items.map((item) => <tr key={item.id}><th scope="row"><Link href={`/review/${item.id}`}>{item.businessName}</Link><small>{item.borrowerName}</small></th><td>{statusLabel[item.lifecycleStatus]}</td><td>{item.metrics.evidenceCovered} / {item.metrics.totalInformation}<small>원문 {item.metrics.evidence}개</small></td><td>{item.metrics.computed} / {item.metrics.totalFeatures}</td><td>{item.metrics.missing}<small>계산 불가 {item.metrics.notCalculable}</small></td><td>{item.signals.length} / 6<small>{item.signals.map((signal) => SIGNAL_LABELS[signal.name as keyof typeof SIGNAL_LABELS]).join(" · ") || "정보 부족"}</small></td><td>{{ PENDING: "미선택", SKIPPED: "선택 보류", SELECTED: "사업자 선택" }[item.planSelected]}</td><td>{{ PENDING: "검토 전", NEEDS_INFORMATION: "추가 확인 필요", REVIEWED: "검토 완료" }[item.reviewStatus]}</td><td>{item.lifecycleStatus !== "ACTIVE" ? <Link href={`/demo/admin?interview=${item.id}`}>검토자료 만들기</Link> : "인터뷰 진행 중"}</td></tr>)}</tbody></table></div>{!result.items.length && <p>아직 검토할 기록이 없습니다. <Link href="/judge-demo">사례로 인터뷰 시작</Link></p>}<nav className={styles.actions}><button onClick={() => setOffset(Math.max(0, offset - 12))} disabled={offset === 0}>이전</button><button onClick={() => setOffset(offset + 12)} disabled={!result.hasMore}>다음</button></nav></>}</section>;
}
export function DataReviewOperator({ interviewId }: { interviewId: string }) {
  const [review, setReview] = useState<DataReview | null>(null);
  const loaded = useCallback((data: DataReview) => setReview(data), []);
  return <><header><p className={styles.eyebrow}>Competition Demo / Synthetic Data · 금융기관 검토 관점</p><h1>{review?.businessName ?? "사업 정보 검토"}</h1><p>사업 현황과 원문 근거, 부족한 자료를 확인하고 상담 준비서를 만듭니다.</p><Link href="/review">검토 목록</Link></header>{review?.snapshotType === "FINAL" && <InstitutionHandoff interviewId={interviewId} />}{review?.summary && <section className={styles.scope}><h2>인터뷰 요약</h2><p>{review.summary}</p></section>}<DataReviewPanel interviewId={interviewId} onLoaded={loaded} />{review?.snapshotType === "FINAL" ? <RecoveryJourney interviewId={interviewId} operator /> : review && <div className={styles.scope}><p>인터뷰가 진행 중입니다. 답변을 확인하고 인터뷰를 마치면 계획 선택과 상담 준비를 할 수 있습니다.</p><Link href={`/borrower/interviews/${interviewId}`}>인터뷰 이어가기</Link></div>}<p className={styles.small}>담당자의 검토는 추가 정보의 확인 상태만 기록합니다. 대출 승인·거절이나 신용등급을 생성하지 않습니다.</p></>;
}
