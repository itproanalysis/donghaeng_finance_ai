"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowRight, Download, Printer } from "lucide-react";
import type { ModelingBundle, ModelingCase, ModelingAxis } from "@/server/modeling-demo";
import { displayModelValue as value, getCaseGoal, getScoreChanges, readReviewDraft, type ModelingReviewDraft } from "@/domain/modeling-workflow";
import styles from "@/app/modeling/workflow.module.css";

type View = "goals" | "reevaluation" | "report";
const decisions = { PENDING: "검토 중", NEEDS_INFORMATION: "자료 보완 필요", READY_FOR_REVIEW: "기관 검토 준비", HOLD: "보류" };
const subscribe = (callback: () => void) => {
  window.addEventListener("storage", callback);
  window.addEventListener("modeling-review-saved", callback);
  return () => { window.removeEventListener("storage", callback); window.removeEventListener("modeling-review-saved", callback); };
};
const serverSnapshot = () => null;

function Axis({ axis, label }: { axis: ModelingAxis; label: string }) {
  return <div className={styles.axis}><span>{label}</span><strong>{value(axis.score)}<small> / 100</small></strong><p>{axis.accounting.earnedPoints} ÷ {axis.accounting.availablePoints} × 100 · {axis.itemsUsed}/{axis.itemsTotal}항목 반영</p></div>;
}

export function ModelingWorkflow({ view, selectedCase, cases, reevaluation, modelVersion, onNavigate }: {
  view: View;
  selectedCase: ModelingCase;
  cases: ModelingCase[];
  reevaluation: ModelingBundle["reevaluation"];
  modelVersion: string;
  onNavigate: (view: View | "impact", caseId?: string) => void;
}) {
  const isFollowup = selectedCase.caseId === reevaluation.afterCase;
  const initialCase = isFollowup ? cases.find((item) => item.caseId === reevaluation.beforeCase) ?? selectedCase : selectedCase;
  const followup = initialCase.caseId === reevaluation.beforeCase ? cases.find((item) => item.caseId === reevaluation.afterCase) : undefined;
  const goal = getCaseGoal(initialCase);
  const key = `donghaeng:modeling-review:v1:${modelVersion}:${initialCase.caseId}`;
  const rawDraft = useSyncExternalStore(subscribe, () => { try { return localStorage.getItem(key); } catch { return null; } }, serverSnapshot);
  const draft = useMemo(() => readReviewDraft(rawDraft), [rawDraft]);
  const [feedback, setFeedback] = useState("");

  function save(patch: Partial<ModelingReviewDraft>) {
    const next = { ...draft, ...patch, updatedAt: new Date().toISOString() };
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event("modeling-review-saved"));
      setFeedback("이 브라우저에 저장했습니다.");
    } catch { setFeedback("브라우저 저장소를 사용할 수 없습니다. 저장하려면 이 사이트의 저장소를 허용해 주세요."); }
  }

  function saveOpinion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const disposition = String(data.get("disposition")) as ModelingReviewDraft["disposition"];
    if (!Object.hasOwn(decisions, disposition)) return;
    save({ disposition, note: String(data.get("note") ?? "").trim().slice(0, 2000) });
  }

  function downloadReport() {
    const report = {
      reportType: "SYNTHETIC_CASE_REVIEW", caseId: selectedCase.caseId, title: selectedCase.title,
      modelVersion, mockData: true, initialAssessment: initialCase.scorecard,
      currentAssessment: selectedCase.scorecard, goal: { feature: goal.feature ?? null, target: goal.target?.value ?? null, horizonDays: goal.horizon?.value ?? null },
      followup: isFollowup && followup ? { ...reevaluation, scorecard: followup.scorecard } : null,
      features: selectedCase.features, cbContext: selectedCase.cbContrast, operatorDraft: draft,
      limitations: "합성 사례의 규칙 기반 상담·심사 보조자료. 신용등급·연체확률·대출 승인 결과가 아닙니다. 검토 메모는 점수에 반영되지 않으며 기관 전송은 수행하지 않습니다.",
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url; anchor.download = `${selectedCase.caseId}-review.json`; anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setFeedback("검토 요약과 근거 데이터를 내려받았습니다.");
  }

  const changed = followup ? getScoreChanges(initialCase, followup) : [];
  const scoreCase = isFollowup && followup ? followup : initialCase;
  const pendingFeatures = selectedCase.features.filter((feature) => feature.usedInScore && ["MISSING", "REFUSED", "UNDECIDED"].includes(feature.status));
  const numericChanges = followup ? initialCase.features.flatMap((feature) => {
    const next = followup.features.find((row) => row.code === feature.code);
    if (!next || typeof feature.value !== "number" || typeof next.value !== "number" || feature.value === next.value || feature.source === "INTERVIEW" || !feature.usedInScore) return [];
    return [{ ...feature, after: next.value }];
  }) : [];

  return <div className={styles.workflow}>
    {view === "goals" && <>
      <header className={styles.heading}><h2>목표와 수행기록</h2><p>평가에 사용한 변수를 목표로 정하고, 같은 자료로 변화를 확인합니다.</p></header>
      <section className={styles.paper} aria-labelledby="goal-heading">
        <div className={styles.sectionTitle}><h3 id="goal-heading">{goal.feature?.label ?? "목표 확인 필요"}</h3><span>{goal.ready ? draft.goalConfirmed ? "목표 확인 기록됨" : "목표 확인 대기" : "목표값·기간 보완 필요"}</span></div>
        <dl className={styles.goalValues}><div><dt>처음 측정한 값</dt><dd>{value(goal.feature?.value, goal.feature?.code)}</dd></div><div><dt>목표값</dt><dd>{value(goal.target?.value, goal.feature?.code)}</dd></div><div><dt>목표 기간</dt><dd>{value(goal.horizon?.value, "horizon_days")}</dd></div></dl>
        <p>{goal.feature?.sourceLabel ?? "원천자료"}에서 다시 측정합니다. {goal.feature?.description}</p>
        <div className={styles.rule}><strong>평가 연결 · 계획의 현실성</strong><span>{goal.scoreItem?.excluded ? `계산 제외 · ${goal.scoreItem.note || goal.scoreItem.band}` : `${goal.scoreItem?.points} / 20점 · ${goal.scoreItem?.band}`}</span><button type="button" onClick={() => onNavigate("impact", initialCase.caseId)}>반영 근거 보기 <ArrowRight size={14} /></button></div>
        <dl className={styles.facts}><div><dt>기록된 실행계획</dt><dd>{value(goal.action?.value)}</dd></div><div><dt>계획 예산</dt><dd>{value(goal.budget?.value, "budget")}</dd></div><div><dt>해결할 과제</dt><dd>{value(goal.problem?.value)} · 걸림돌: {value(goal.blocker?.value)}</dd></div></dl>
        <p className={styles.note}>목표와 실행계획은 사례의 입력값입니다. 담당자가 실행계획이 목표 달성에 적합한지 확인합니다.</p>
        <button type="button" className={styles.button} disabled={!goal.ready} onClick={() => save({ goalConfirmed: !draft.goalConfirmed })}>{draft.goalConfirmed ? "목표 확인 취소" : "이 목표 확인 기록"}</button>
      </section>
      <section className={styles.paper} aria-labelledby="records-heading">
        <div className={styles.sectionTitle}><h3 id="records-heading">수행자료</h3><span>{followup ? `${reevaluation.monthlyRecords.length}개월 · 합성 거래자료` : "후속 자료 없음"}</span></div>
        {followup ? <>
          <p>{reevaluation.baselineAsOf} 평가 이후의 카드매출 기록입니다. 출처: {reevaluation.recordSource}</p>
          <div className={styles.tableWrap}><table><caption>월별 매출과 영업일 · 마지막 3개월이 목표 판정에 사용됩니다.</caption><thead><tr><th>기간</th><th>카드매출</th><th>결제 건수</th><th>영업일</th><th>목표 산출</th></tr></thead><tbody>{reevaluation.monthlyRecords.map((row) => <tr key={row.month}><th scope="row">{row.month}</th><td>{value(row.sales, "sales_avg")}</td><td>{value(row.transactions, "transaction_count")}</td><td>{row.operatingDays}일</td><td>{row.includedInGoal ? "최근 3개월" : "경과 기록"}</td></tr>)}</tbody></table></div>
          <p className={styles.note}>{reevaluation.measurementRule}합니다. 수기 메모와 확인 표시는 산출값에 영향을 주지 않습니다.</p>
          <div className={styles.actions}><button type="button" className={styles.button} onClick={() => save({ recordsReviewed: !draft.recordsReviewed })}>{draft.recordsReviewed ? "자료 확인 취소" : "수행자료 확인 기록"}</button><button type="button" className={styles.primary} onClick={() => onNavigate("reevaluation", initialCase.caseId)}>이 자료의 재평가 결과 <ArrowRight size={16} /></button></div>
        </> : <div className={styles.empty}><p>이 사례에는 후속 거래자료가 등록되어 있지 않습니다. 자료를 확보한 뒤 같은 변수와 기간으로 재평가합니다.</p><button type="button" onClick={() => onNavigate("goals", reevaluation.beforeCase)}>영업일 회복 사례의 수행기록 보기 <ArrowRight size={16} /></button></div>}
      </section>
    </>}

    {view === "reevaluation" && <>
      <header className={styles.heading}><h2>수행자료 반영 후 재평가</h2><p>{followup ? `최초 평가 ${reevaluation.baselineAsOf} → 재평가 ${reevaluation.followupAsOf}` : "선택한 사례의 후속 자료와 재평가 여부를 확인합니다."}</p></header>
      {!followup ? <div className={styles.empty}><h3>아직 재평가할 후속 자료가 없습니다.</h3><p>현재 선택한 사례의 최초 평가만 제공됩니다.</p><button type="button" onClick={() => onNavigate("reevaluation", reevaluation.beforeCase)}>영업일 회복 재평가 사례 보기 <ArrowRight size={16} /></button></div> : <>
        <div className={styles.goalResult}><div><span>{goal.feature?.label} · 최근 3개월 평균</span><strong>{value(reevaluation.before, reevaluation.goalFeature)} → {value(reevaluation.after, reevaluation.goalFeature)}</strong></div><p>목표 {value(reevaluation.target, reevaluation.goalFeature)} <b>{reevaluation.reached === true ? "달성" : reevaluation.reached === false ? "미달" : "판정 보류"}</b></p></div>
        <p className={styles.note}>{reevaluation.monthlyRecords.filter((row) => row.includedInGoal).map((row) => row.operatingDays).join(" + ")}일 ÷ 3개월 = {value(reevaluation.after, reevaluation.goalFeature)}. 목표 달성만으로 점수를 가산하지 않습니다.</p>
        <div className={styles.comparison}><section><h3>최초 평가</h3><Axis axis={initialCase.scorecard.currentSituation} label="현재 상황" /><Axis axis={initialCase.scorecard.improvement} label="개선가능성" /></section><section><h3>새 자료로 재산출</h3><Axis axis={followup.scorecard.currentSituation} label="현재 상황" /><Axis axis={followup.scorecard.improvement} label="개선가능성" /></section></div>
        <p className={styles.boundary}>재평가에서는 과거 답변 30개를 재사용하지 않습니다. 개선가능성은 반영 항목이 {initialCase.scorecard.improvement.itemsUsed}개에서 {followup.scorecard.improvement.itemsUsed}개로 달라졌으므로 점수 상승을 신용 개선률로 해석할 수 없습니다.</p>
        <section className={styles.paper}><h3>평가항목별 변화</h3><div className={styles.tableWrap}><table><thead><tr><th>평가항목</th><th>최초 배점</th><th>재평가 배점</th><th>새 자료에 따른 판단</th></tr></thead><tbody>{changed.map((row) => <tr key={`${row.axis}-${row.name}`}><th scope="row">{row.name}<small>{row.axis === "currentSituation" ? "현재 상황" : "개선가능성"}</small></th><td>{row.before.excluded ? "제외" : `${row.before.points}/20`}</td><td>{row.after.excluded ? "제외" : `${row.after.points}/20`}</td><td>{row.after.note || row.after.band}</td></tr>)}</tbody></table></div></section>
        <details className={styles.paper}><summary>변경된 수치 변수 {numericChanges.length}개 확인</summary><div className={styles.tableWrap}><table><thead><tr><th>변수</th><th>최초</th><th>재산출</th><th>출처</th></tr></thead><tbody>{numericChanges.map((row) => <tr key={row.code}><th scope="row">{row.label}</th><td>{value(row.value, row.code)}</td><td>{value(row.after, row.code)}</td><td>{row.sourceLabel}</td></tr>)}</tbody></table></div></details>
        <div className={styles.actions}><button type="button" className={styles.button} onClick={() => onNavigate("goals", initialCase.caseId)}>수행기록 확인</button><button type="button" className={styles.primary} onClick={() => onNavigate("report", followup.caseId)}>재평가 검토 요약 <ArrowRight size={16} /></button></div>
      </>}
    </>}

    {view === "report" && <>
      <article id="modeling-review-report" className={styles.report}>
        <header className={styles.heading}><span>동행금융 · 합성 사례 검토자료</span><h2>기관 검토용 요약</h2><p>{selectedCase.title} · {isFollowup ? "재평가" : "최초 평가"}</p></header>
        <section><h3>1. 평가 결과와 산출 범위</h3><div className={styles.reportAxes}><Axis axis={scoreCase.scorecard.currentSituation} label="현재 상황" /><Axis axis={scoreCase.scorecard.improvement} label="개선가능성" /></div><p>신용정보(CB)와 함께 검토할 사업·행동 지표입니다. 현재 모형은 연체확률·대출 한도·금리를 산출하지 않습니다.</p></section>
        <section><h3>2. 목표 및 수행자료</h3><p>{goal.feature?.label ?? "목표 미확인"}: {value(goal.feature?.value, goal.feature?.code)} → 목표 {value(goal.target?.value, goal.feature?.code)} · {value(goal.horizon?.value, "horizon_days")}</p><p>{isFollowup && followup ? `후속 거래자료 ${reevaluation.monthlyRecords.length}개월 반영 · 최근 3개월 ${value(reevaluation.after, reevaluation.goalFeature)} · ${reevaluation.reached === true ? "목표 달성" : "목표 미달"}` : "이 요약은 최초 평가 기준입니다. 후속 자료 반영 결과는 재평가에서 확인합니다."}</p><p>담당자 확인 기록: 목표 {draft.goalConfirmed ? "확인" : "대기"} / 수행자료 {draft.recordsReviewed ? "확인" : "대기"}</p></section>
        <section><h3>3. 추가 확인할 평가자료</h3><p>직접 평가에 쓰이는 변수 중 {pendingFeatures.length}개가 미확인·거절·미결정 상태입니다.</p>{pendingFeatures.length > 0 && <ul className={styles.pending}>{pendingFeatures.map((feature) => <li key={feature.code}>{feature.label} · {value(feature.value)}</li>)}</ul>}<p>별도 기관 검토 전에는 자료의 진위·최신성, 고객의 제공 동의와 기관별 제출 요건을 확인해야 합니다.</p></section>
        <section><h3>4. 담당자 검토 의견</h3><p><strong>{decisions[draft.disposition]}</strong>{draft.updatedAt && <small> · 저장 {new Date(draft.updatedAt).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })}</small>}</p><p className={styles.savedNote}>{draft.note || "아직 작성된 검토 의견이 없습니다."}</p></section>
        <footer>모형 {modelVersion} · 합성 데이터 · 실제 고객 심사·대출중개·기관 전송을 수행한 자료가 아닙니다.</footer>
      </article>
      <form className={styles.opinionForm} onSubmit={saveOpinion} key={`${key}:${draft.updatedAt}`}>
        <h3>검토 의견 기록</h3><label htmlFor="review-disposition">후속 검토 상태</label><select id="review-disposition" name="disposition" defaultValue={draft.disposition}>{Object.entries(decisions).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <label htmlFor="review-note">검토 메모</label><textarea id="review-note" name="note" rows={4} maxLength={2000} defaultValue={draft.note} placeholder="보완할 자료, 변수 해석 시 유의점과 다음 조치를 기록하세요." /><p className={styles.note}>이 브라우저에만 저장됩니다. 메모는 평가 점수에 반영되지 않습니다.</p><button type="submit" className={styles.primary}>검토 의견 저장</button>
      </form>
      <div className={styles.actions}><button type="button" className={styles.button} onClick={() => window.print()}><Printer size={16} /> 요약 인쇄 · PDF 저장</button><button type="button" className={styles.button} onClick={downloadReport}><Download size={16} /> 요약·근거 JSON 받기</button></div>
    </>}
    <p className={styles.feedback} role="status" aria-live="polite">{feedback}</p>
  </div>;
}
