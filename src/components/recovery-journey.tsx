"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ArrowRight } from "lucide-react";
import { ApiRequestError, authenticatedFetch, readApiEnvelope } from "./api-adapter";
import { recoveryCommand, type RecoveryCommandReceipt } from "./recovery-command";
import { RECOVERY_MISSIONS, type RecoveryState } from "@/domain/recovery-journey";
import type { DataReview } from "@/domain/data-review";
import styles from "@/app/data-engine.module.css";

const REVIEW_LABELS = { PENDING: "검토 전", NEEDS_INFORMATION: "추가 확인 필요", REVIEWED: "검토 완료" } as const;
const ThreeRecoveryJourneyScene = dynamic(() => import("./three-recovery-journey-scene"), { ssr: false });
export function RecoveryJourney({ interviewId, operator = false }: { interviewId: string; operator?: boolean }) {
  const [state, setState] = useState<RecoveryState | null>(null);
  const [dataReview, setDataReview] = useState<DataReview | null>(null);
  const [candidateId, setCandidateId] = useState("");
  const [missionId, setMissionId] = useState(1);
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [observedOn, setObservedOn] = useState("");
  const [reviewNote, setReviewNote] = useState("");
  const [reviewStatus, setReviewStatus] = useState("NEEDS_INFORMATION");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const commandRef = useRef<RecoveryCommandReceipt | null>(null);
  const locked = useRef(false);
  const refresh = useCallback(async () => {
    const results = await Promise.all([
      authenticatedFetch(`/api/interviews/${interviewId}/recovery`, { cache: "no-store" }).then(readApiEnvelope),
      authenticatedFetch(`/api/interviews/${interviewId}/data-review`, { cache: "no-store" }).then(readApiEnvelope),
    ]);
    setState(results[0] as RecoveryState); setDataReview(results[1] as DataReview); setError(null);
  }, [interviewId]);
  useEffect(() => {
    let active = true;
    Promise.all([authenticatedFetch(`/api/interviews/${interviewId}/recovery`, { cache: "no-store" }).then(readApiEnvelope), authenticatedFetch(`/api/interviews/${interviewId}/data-review`, { cache: "no-store" }).then(readApiEnvelope)])
      .then(([state, review]) => { if (active) { const saved = state as RecoveryState; setState(saved); setDataReview(review as DataReview); setMissionId(RECOVERY_MISSIONS.find((item) => !saved.completedMissionIds.includes(item.id))?.id ?? 3); setReviewStatus(saved.review.status === "REVIEWED" ? "REVIEWED" : "NEEDS_INFORMATION"); } })
      .catch((error: Error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [interviewId]);
  async function mutate(action: string, values: Record<string, unknown>) {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(null); setSaved(null);
    commandRef.current = recoveryCommand(commandRef.current, action, values);
    try {
      const result = await readApiEnvelope(await authenticatedFetch(`/api/interviews/${interviewId}/recovery`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(commandRef.current.body) })) as RecoveryState;
      setState(result); commandRef.current = null;
      setSaved(action === "ADD_EVIDENCE" ? "NEW EVIDENCE · 자기보고 실행기록을 서버에 저장했습니다." : action === "SELECT_ACTION" ? "선택 기록을 저장했습니다. 신용판단에는 사용하지 않습니다." : "담당자 검토 기록을 저장했습니다.");
      if (action === "ADD_EVIDENCE") { setTitle(""); setNote(""); setObservedOn(""); setMissionId(Math.min(3, missionId + 1)); }
    } catch (error) {
      // A definitive CAS rejection did not write anything; retry after refresh uses a new version.
      if (error instanceof ApiRequestError && ["RECOVERY_REVISION_CONFLICT", "REVIEW_REVISION_CONFLICT"].includes(error.code ?? "")) commandRef.current = null;
      setError(error instanceof Error ? error.message : "기록을 저장하지 못했습니다.");
    }
    finally { locked.current = false; setBusy(false); }
  }
  const chosen = state?.selection?.choice;
  const mission = RECOVERY_MISSIONS.find((item) => item.id === missionId)!;
  return <section className={styles.mission} id="recovery" aria-label={operator ? "사업자 Action과 담당자 검토" : "Recovery Journey"}>
    <p className={styles.eyebrow}>{operator ? "HUMAN REVIEW" : "AFTER ANALYSIS · RECOVERY JOURNEY"}</p><h2>{operator ? "사업자가 선택한 Action과 새 Evidence" : "선택한 계획을 실제 행동으로 바꿔봅니다."}</h2>
    {error && <div className={styles.notice} role="alert">{error} <button disabled={busy} onClick={() => void refresh().catch((error: Error) => setError(error.message))}>최신 기록 불러오기</button></div>}
    {saved && <p className={styles.notice} role="status">{saved}</p>}
    {!state && !error && <p role="status">실행기록을 불러오는 중입니다.</p>}
    {state && <>
      {!operator && <div className={styles.journeyScene}><ThreeRecoveryJourneyScene completedMissionIds={state.completedMissionIds} /></div>}
      {!state.selection && !operator && <section><h3>현재 확인된 개선 후보</h3><p>앞에서 확인한 Feature·Signal·근거를 바탕으로 앞으로 살펴볼 Action 하나를 직접 선택하세요. 선택은 의무가 아니며 기록 후 원본을 덮어쓰지 않습니다.</p><div className={styles.choices}>{dataReview?.candidates.map((candidate) => <label key={candidate.id}><input type="radio" name="recovery-action" value={candidate.id} checked={candidateId === candidate.id} onChange={(event) => setCandidateId(event.target.value)} disabled={busy} />{candidate.title}<small>{candidate.origin === "CATALOG_SUGGESTION" ? "일반 참고 제안" : "인터뷰 근거 기반 후보"} · Evidence {candidate.evidenceIds.length}개</small></label>)}</div><label className={styles.consent}><input type="radio" name="recovery-action" value="SKIP" checked={candidateId === "SKIP"} onChange={() => setCandidateId("SKIP")} disabled={busy} />지금은 선택하지 않겠습니다.</label><button className={styles.primary} disabled={!candidateId || busy} onClick={() => void mutate("SELECT_ACTION", { candidateId })}>내 선택 저장</button></section>}
      {!state.selection && operator && <p>사업자가 아직 Action을 선택하지 않았습니다. <Link href={`/recovery/${interviewId}`}>사업자 선택 화면</Link></p>}
      {state.selection && <div className={styles.scope}><strong>{chosen === "SKIP" ? "사업자가 선택을 보류했습니다." : chosen?.title}</strong><p className={styles.small}>선택 시각 {state.selection.selectedAt} · {state.selection.eventType}<br />사용자 선택 · append-only 기록 · 신용판단·데이터 품질 점수에 직접 사용하지 않음</p></div>}
      <ol className={styles.judgeProgress} aria-label="미션 기록 현황">{RECOVERY_MISSIONS.map((item) => <li key={item.id}>Mission {item.id} · {item.title}<br />{state.completedMissionIds.includes(item.id) ? "자기보고 기록 확보" : "아직 기록 없음"}</li>)}</ol>
      {!operator && chosen && chosen !== "SKIP" && <form onSubmit={(event) => { event.preventDefault(); void mutate("ADD_EVIDENCE", { missionId, title, note, observedOn, expectedRevision: state.revision }); }}><h3>새 Evidence 남기기</h3><p className={styles.small}>현재는 자료 준비·실행 내용을 자기보고 텍스트로 기록합니다. 파일을 업로드하거나 증빙의 진위를 확인하는 기능은 제공하지 않습니다. 실제 고객정보를 입력하지 마세요.</p><label>미션<select value={missionId} disabled={busy} onChange={(event) => { setMissionId(Number(event.target.value)); setTitle(""); setNote(""); }}>
        {RECOVERY_MISSIONS.map((item) => <option key={item.id} value={item.id} disabled={item.id > 1 && !state.completedMissionIds.includes(item.id - 1)}>Mission {item.id} · {item.title}</option>)}
      </select></label><p>{mission.description}</p><button type="button" className={styles.textButton} disabled={busy} onClick={() => { setTitle(mission.exampleTitle); setNote(mission.exampleNote); setObservedOn(new Date().toISOString().slice(0, 10)); }}>합성 예시 기록 불러오기</button><label>자료 또는 행동 이름<input value={title} required maxLength={120} onChange={(event) => setTitle(event.target.value)} disabled={busy} /></label><label>기록 기준일<input type="date" value={observedOn} required onChange={(event) => setObservedOn(event.target.value)} disabled={busy} /></label><label>구체적인 기록<textarea value={note} required minLength={10} maxLength={2000} onChange={(event) => setNote(event.target.value)} disabled={busy} /></label><button className={styles.primary} disabled={busy || !title.trim() || note.trim().length < 10 || !observedOn} type="submit">{busy ? "저장 중…" : "NEW EVIDENCE 저장"}</button></form>}
      <section aria-label="새 Evidence 원문"><h3>새 Evidence · {state.evidence.length}개</h3>{!state.evidence.length && <p className={styles.small}>아직 실행기록이 없습니다. 체크만으로 Evidence가 생성되지는 않습니다.</p>}{state.evidence.map((evidence) => <article key={evidence.id}><small>Mission {evidence.missionId} · {evidence.observedOn} · SELF_REPORTED</small><h4>{evidence.title}</h4><p>{evidence.note}</p><code>{evidence.id}</code><details><summary>저장·무결성 정보</summary><p>저장 시각 {evidence.createdAt}<br />연결 FINAL {evidence.finalSnapshotId}</p><code>{evidence.contentHash}</code><p>인터뷰 종료 원본과 구분된 append-only 자기보고 기록입니다. 사업 성과 검증이나 자동 재평가를 뜻하지 않습니다.</p></details></article>)}</section>
      <p className={styles.scope}>이 기록은 향후 재평가 시 새로운 Evidence로 활용될 수 있습니다.</p>
      <section><h3>Review Status · {REVIEW_LABELS[state.review.status]}</h3>{state.review.note && <p>{state.review.note}</p>}<p className={styles.small}>검토 revision {state.review.revision}{state.review.reviewedAt && ` · ${state.review.reviewedAt}`}</p>{operator && <form onSubmit={(event) => { event.preventDefault(); void mutate("REVIEW", { status: reviewStatus, note: reviewNote, expectedRevision: state.review.revision }); }}><label>검토 상태<select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value)} disabled={busy}><option value="NEEDS_INFORMATION">추가 확인 필요</option><option value="REVIEWED">검토 완료</option></select></label><label>확인한 내용 또는 보완 요청<textarea value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} required maxLength={2000} disabled={busy} /></label><button type="submit" className={styles.primary} disabled={busy || !reviewNote.trim()}>검토 기록 저장</button><p className={styles.small}>정보 검토 상태만 기록합니다. 대출 승인·거절 판단이 아닙니다.</p></form>}</section>
      {!operator && <p><Link href={`/review/${interviewId}`}>금융기관 관점에서 결과 검토 <ArrowRight size={15} /></Link></p>}
    </>}
  </section>;
}
