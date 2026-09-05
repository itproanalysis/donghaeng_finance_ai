"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { adaptModelingScorecard, authenticatedFetch, readApiEnvelope, type ModelingScorecardView, type ScorecardAxisView } from "@/components/api-adapter";

function Axis({ label, axis }: { label: string; axis: ScorecardAxisView }) {
  const included = axis.items.filter((item) => !item.excluded);
  const earned = included.reduce((sum, item) => sum + (item.points ?? 0), 0);
  return <section className="scorecard-axis" aria-label={label}>
    <div className="scorecard-axis__head"><h4>{label}</h4><strong>{axis.score === null ? axis.scoreLabel : `${Number(axis.score.toFixed(2))}점`}</strong></div>
    <p className="scorecard-axis__basis">{earned} / {included.length * 20} × 100 · {axis.itemsUsed}/{axis.itemsTotal}개 항목 반영</p>
    <ul className="scorecard-axis__items">{axis.items.map((item) => <li key={item.name} data-excluded={item.excluded || undefined}>
      <span>{item.name}</span><em>{item.excluded ? "산출 제외" : `${item.points ?? "—"} / 20`}</em><small>{item.band}{item.note ? ` · ${item.note}` : ""}</small>
    </li>)}</ul>
    {axis.note && <p className="scorecard-axis__basis">{axis.note}</p>}
  </section>;
}

export function LiveModelingScorecard({ evaluationId }: { evaluationId: string }) {
  const [state, setState] = useState<{ id: string; card: ModelingScorecardView | null; loading: boolean }>({ id: evaluationId, card: null, loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    authenticatedFetch(`/api/interview-evaluations/${encodeURIComponent(evaluationId)}/scorecard`, { cache: "no-store" })
      .then(readApiEnvelope)
      .then((data) => { if (active) setState({ id: evaluationId, card: adaptModelingScorecard(data), loading: false }); })
      .catch(() => { if (active) setState({ id: evaluationId, card: null, loading: false }); });
    return () => { active = false; };
  }, [evaluationId, attempt]);
  const loading = state.id !== evaluationId || state.loading;
  const card = state.id === evaluationId ? state.card : null;
  return <article className="assessment-card assessment-card--scorecard" aria-busy={loading}>
    <div className="assessment-card__heading"><div><span>거래자료 · 완료한 답변</span><h3>사업·행동 평가</h3></div></div>
    {loading ? <p role="status">답변을 변수로 정리하고 평가를 계산하고 있습니다…</p> : card?.status === "READY" && card.currentSituation && card.improvement ? <>
      <p className="scorecard-source">{card.transactionDataSource}</p>
      <Axis label="현재 상황" axis={card.currentSituation} /><Axis label="개선가능성" axis={card.improvement} />
      <p className="scorecard-axis__basis">항목별 최대 20점입니다. 자료가 없는 항목은 분자·분모에서 제외합니다. 두 축은 별도 지표이며 신용등급이나 승인 확률이 아닙니다.</p>
      <Link href="/modeling?case=case_operating_drop&tab=features">기준 합성 사례의 변수·산출 근거 보기</Link>
    </> : <div className="assessment-empty"><div><strong>평가 결과 미산출</strong><p>{card?.unavailableMessage ?? "평가 결과를 불러오지 못했습니다."}</p><button type="button" className="borrower-text-button" onClick={() => { setState({ id: evaluationId, card: null, loading: true }); setAttempt((value) => value + 1); }}>다시 확인</button><Link href="/modeling?case=case_operating_drop&tab=impact">평가 사례 보기</Link></div></div>}
  </article>;
}
