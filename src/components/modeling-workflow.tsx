"use client";

import { useEffect, useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import { ArrowRight, Download, Printer } from "lucide-react";
import type { ModelingBundle, ModelingCase, ModelingAxis } from "@/server/modeling-demo";
import { displayModelValue as value, getCaseGoal, getScoreChanges, readReviewDraft, type ModelingReviewDraft } from "@/domain/modeling-workflow";
import { ModelingInstitutionReport, MODELING_REVIEW_LABELS } from "./modeling-institution-report";
import { InstitutionReviewWorkspace } from "./institution-review-workspace";
import reviewStyles from "@/app/institution-review.module.css";
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
  const [opinionDirty, setOpinionDirty] = useState(false);
  useEffect(() => {
    if (!opinionDirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [opinionDirty]);

  function save(patch: Partial<ModelingReviewDraft>) {
    const next = { ...draft, ...patch, updatedAt: new Date().toISOString() };
    try {
      localStorage.setItem(key, JSON.stringify(next));
      window.dispatchEvent(new Event("modeling-review-saved"));
      setFeedback("이 브라우저에 저장했습니다.");
      setOpinionDirty(false);
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
    if (opinionDirty) return;
    const report = {
      reportType: "SYNTHETIC_CASE_REVIEW", caseId: selectedCase.caseId, title: selectedCase.title,
      modelVersion, mockData: true, initialAssessment: initialCase.scorecard,
      currentAssessment: selectedCase.scorecard, goal: { feature: goal.feature ?? null, target: goal.target?.value ?? null, horizonDays: goal.horizon?.value ?? null },
      followup: isFollowup && followup ? { ...reevaluation, scorecard: followup.scorecard } : null,
      sourceSummary: selectedCase.sourceSummary, featureSummary: selectedCase.featureSummary, interviewConversion: selectedCase.interviewConversion, exportedAt: new Date().toISOString(),
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
      <InstitutionReviewWorkspace
        title={selectedCase.title} context={`${isFollowup ? "6개월 후 자료" : "최초 분석"} · 합성 거래자료`}
        status={MODELING_REVIEW_LABELS[draft.disposition]}
        metrics={[{ label: "값이 있는 변수", value: `${selectedCase.featureSummary.valueCount} / ${selectedCase.featureSummary.total}` }, { label: "인터뷰 원문", value: `${selectedCase.interviewConversion.items.filter((item) => item.evidencePresent).length}개` }, { label: "의견 기록", value: draft.updatedAt ? "저장됨" : "작성 전" }]}
        notice={opinionDirty ? "작성 중인 의견을 먼저 저장하세요." : feedback || (draft.updatedAt ? "저장된 의견을 최종 자료에 포함합니다." : "의견 작성 전에도 현재 자료를 받을 수 있습니다.")}
        actions={<><button type="button" disabled={opinionDirty} onClick={downloadReport}><Download size={15} />최종 검토자료 받기</button><button type="button" disabled={opinionDirty} onClick={() => window.print()}><Printer size={15} />검토자료 인쇄·PDF</button></>}
        panels={{
          overview: <ModelingInstitutionReport selectedCase={selectedCase} initialCase={initialCase} reevaluation={reevaluation} modelVersion={modelVersion} draft={draft} section="overview" />,
          evidence: <><ModelingInstitutionReport selectedCase={selectedCase} initialCase={initialCase} reevaluation={reevaluation} modelVersion={modelVersion} draft={draft} section="evidence" /><button type="button" className={reviewStyles.quietButton} onClick={() => onNavigate("impact", selectedCase.caseId)}>94개 변수의 전체 평가 과정<ArrowRight size={14} /></button></>,
          plan: <><ModelingInstitutionReport selectedCase={selectedCase} initialCase={initialCase} reevaluation={reevaluation} modelVersion={modelVersion} draft={draft} section="plan" /><fieldset className={reviewStyles.checks}><legend>담당자 확인 기록</legend><label><input type="checkbox" checked={draft.goalConfirmed} disabled={!goal.ready || opinionDirty} onChange={(event) => save({ goalConfirmed: event.target.checked })} />기록된 목표를 확인했습니다.</label><label><input type="checkbox" checked={draft.recordsReviewed} disabled={!followup || opinionDirty} onChange={(event) => save({ recordsReviewed: event.target.checked })} />수행자료를 확인했습니다.</label></fieldset></>,
          opinion: <><h2>담당자 의견</h2><p className={reviewStyles.sectionLead}>보완할 자료와 다음 확인 사항을 기록하세요.</p><ModelingInstitutionReport selectedCase={selectedCase} initialCase={initialCase} reevaluation={reevaluation} modelVersion={modelVersion} draft={draft} section="opinion" /><form className={reviewStyles.form} onSubmit={saveOpinion} onChange={() => setOpinionDirty(true)} key={`${key}:${draft.updatedAt}`}><label htmlFor="review-disposition">후속 검토 상태<select id="review-disposition" name="disposition" defaultValue={draft.disposition}>{Object.entries(decisions).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label htmlFor="review-note">검토 메모<textarea id="review-note" name="note" rows={5} maxLength={2000} defaultValue={draft.note} placeholder="추가로 확인할 자료와 검토 의견을 입력하세요." /></label><p className={reviewStyles.muted}>이 브라우저에 저장됩니다. 메모는 평가값에 반영되지 않습니다.</p><button type="submit">검토 의견 저장</button></form></>,
          export: <><h2>자료 내보내기</h2><p className={reviewStyles.sectionLead}>현재 선택한 자료와 저장된 담당자 의견을 한 검토서로 정리합니다.</p><dl className={reviewStyles.facts}><div><dt>검토 대상</dt><dd>{selectedCase.title}</dd></div><div><dt>자료 시점</dt><dd>{isFollowup ? "6개월 후" : "최초 분석"}</dd></div></dl><ul><li>사업 현황과 주요 변수</li><li>94개 변수, 평가 산식과 원문 근거</li><li>목표와 확보한 수행자료</li><li>미확인 항목과 저장된 담당자 의견</li></ul><ModelingInstitutionReport selectedCase={selectedCase} initialCase={initialCase} reevaluation={reevaluation} modelVersion={modelVersion} draft={draft} section="opinion" /><p className={reviewStyles.muted}>‘최종 검토자료 받기’는 근거 데이터를 포함한 JSON 파일을 만듭니다. 문서는 ‘검토자료 인쇄·PDF’에서 저장할 수 있습니다.</p><p className={reviewStyles.boundary}>Competition Demo / Synthetic Data. 기관에 자동 전송하거나 대출 신청을 접수하지 않습니다.</p></>,
        }}
      />
      <div className={reviewStyles.printOnly}><ModelingInstitutionReport selectedCase={selectedCase} initialCase={initialCase} reevaluation={reevaluation} modelVersion={modelVersion} draft={draft} /></div>
    </>}
    {view !== "report" && <p className={styles.feedback} role="status" aria-live="polite">{feedback}</p>}
  </div>;
}
