"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";
import { adaptInterviewSnapshot, authenticatedFetch, createClientCommandId, extractMessageProcessingTelemetry, readApiEnvelope, type InterviewSnapshotView } from "./api-adapter";
import { useInterviewEvents } from "@/realtime/use-interview-events";
import type { LiveConnectionState } from "@/realtime/live-store";
import { createBorrowerRequiredInformationList } from "./borrower-interview-preferences";
import { DataReviewPanel } from "./data-review-panel";
import { EngineArchitecture } from "./engine-introduction";
import { JUDGE_DEMO } from "@/domain/judge-demo";
import type { DataReview } from "@/domain/data-review";
import styles from "@/app/data-engine.module.css";
import { judgeDemoProgress } from "./judge-demo-progress";

async function post(path: string, body: unknown) { return readApiEnvelope(await authenticatedFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })); }

export function JudgeDemo({ initialInterviewId }: { initialInterviewId?: string }) {
  const router = useRouter();
  const [snapshot, setSnapshot] = useState<InterviewSnapshotView | null>(null);
  const [review, setReview] = useState<DataReview | null>(null);
  const [consent, setConsent] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<LiveConnectionState>("CONNECTING");
  const created = useRef<string | null>(initialInterviewId ?? null);
  const pending = useRef<{ clientMessageId: string; text: string; expectedVersion: number; currentQuestionInfoCode: string | null } | null>(null);
  const finalCommand = useRef<Record<string, unknown> | null>(null);
  const lock = useRef(false);
  const reviewLoaded = useCallback((data: DataReview) => setReview(data), []);
  useEffect(() => {
    if (!initialInterviewId) return;
    let active = true;
    authenticatedFetch(`/api/interviews/${encodeURIComponent(initialInterviewId)}`, { cache: "no-store" }).then(readApiEnvelope).then((data) => {
      if (active) setSnapshot(adaptInterviewSnapshot(data));
    }).catch((error: Error) => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [initialInterviewId]);
  const live = snapshot?.snapshotType === "PREVIEW" ? snapshot : null;
  const progress = live ? judgeDemoProgress(live) : null;
  const answerCount = progress?.answerCount ?? (snapshot?.snapshotType === "FINAL" ? 3 : 0);
  const eligible = !snapshot || (snapshot.businessName === JUDGE_DEMO.businessName && snapshot.borrowerName === JUDGE_DEMO.borrowerName && (!progress || progress.matchesScript));
  const nextAnswer = progress?.nextAnswer;
  const syncSnapshot = useCallback(async () => {
    if (!created.current) return;
    const next = adaptInterviewSnapshot(await readApiEnvelope(await authenticatedFetch(`/api/interviews/${created.current}`, { cache: "no-store" })));
    // A committed SSE batch can arrive before a failed HTTP response is retried.
    // Clear a receipt only after the authoritative domain version commits, not on raw transcript persistence.
    if (pending.current && next.snapshotType === "PREVIEW" && !next.pendingCommand && next.version > pending.current.expectedVersion) pending.current = null;
    if (finalCommand.current && next.snapshotType === "PREVIEW" && next.version !== finalCommand.current.expectedVersion) finalCommand.current = null;
    setSnapshot((before) => !before || next.version >= before.version ? next : before);
    return next.lastEventSeq;
  }, []);
  useInterviewEvents({ interviewId: live?.id ?? "", afterSeq: live?.lastEventSeq ?? 0, enabled: Boolean(live),
    onEvent: () => {}, onBatchCommitted: async () => { try { await syncSnapshot(); } catch { /* explicit request/retry reports errors */ } },
    onConnectionChange: setConnection, onResyncRequired: syncSnapshot,
  });
  async function start() {
    if (!consent || lock.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      if (!created.current) {
        const data = await post("/api/interviews", { industryCode: JUDGE_DEMO.industryCode, profile: { businessName: JUDGE_DEMO.businessName, borrowerName: JUDGE_DEMO.borrowerName }, requiredInformationList: createBorrowerRequiredInformationList("CAFE", "FULL_REVIEW") });
        const initial = adaptInterviewSnapshot(data); created.current = initial.id;
      }
      await post(`/api/interviews/${created.current}/consents`, { purpose: "CLOUD_AI_PROCESSING", consentVersion: "cloud-ai-processing-v1", granted: true, expiresAt: null });
      setSnapshot(adaptInterviewSnapshot(await readApiEnvelope(await authenticatedFetch(`/api/interviews/${created.current}`))));
      router.replace(`/judge-demo?interview=${encodeURIComponent(created.current)}`);
    } catch (error) { setError(error instanceof Error ? error.message : "시연을 시작하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function answer() {
    if (!live || !nextAnswer || !eligible || lock.current) return;
    lock.current = true; setBusy(true); setError(null); setConfirmed(false);
    try {
      pending.current ??= live.pendingCommand
        ? { clientMessageId: live.pendingCommand.clientMessageId, text: live.pendingCommand.text, expectedVersion: live.pendingCommand.expectedVersion, currentQuestionInfoCode: live.pendingCommand.currentQuestionInfoCode }
        : { clientMessageId: createClientCommandId("judge-answer"), text: nextAnswer, expectedVersion: live.version, currentQuestionInfoCode: live.currentQuestionInfoCode };
      const result = await post(`/api/interviews/${live.id}/messages`, pending.current);
      const telemetry = extractMessageProcessingTelemetry(result);
      if (telemetry && telemetry.status !== "APPLIED") throw new Error("서버가 답변 처리를 완료하지 못했습니다. 같은 요청을 다시 시도하거나 전체 인터뷰에서 확인해 주세요.");
      setSnapshot(adaptInterviewSnapshot(await readApiEnvelope(await authenticatedFetch(`/api/interviews/${live.id}`))));
      pending.current = null;
    } catch (error) { setError(error instanceof Error ? error.message : "답변 처리에 실패했습니다. 같은 답변을 다시 시도할 수 있습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function finalize() {
    if (!live || !confirmed || lock.current || pending.current || live.pendingCommand) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      finalCommand.current ??= { clientCommandId: createClientCommandId("judge-final"), expectedVersion: live.version, mode: "FORCE_INCOMPLETE", borrowerConfirmed: true, reason: "합성 기술 데모의 3개 답변으로 확인한 범위만 보존하며 미확인 항목을 포함해 종료함" };
      const data = await post(`/api/interviews/${live.id}/complete`, finalCommand.current);
      setSnapshot(adaptInterviewSnapshot(data));
    } catch (error) { setError(error instanceof Error ? error.message : "종료 기록을 저장하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main id="main-content" className={styles.page}>
    <header className={styles.judgeHeader}><div><p className={styles.eyebrow}>Competition Demo / Synthetic Data · 3분</p><h1>사업 이야기가<br />상담 자료로 정리되는 과정</h1><p>가상 카페의 답변으로 사업 정보를 정리하고, 근거를 확인한 뒤 금융기관 상담을 준비합니다.</p></div><Link href="/about">서비스 소개</Link></header>
    <ol className={styles.judgeProgress} aria-label="심사 데모 흐름">{["사업 현황", "인터뷰", "변수와 근거", "결과 확인", "실행·금융상담"].map((label, index) => <li key={label} aria-current={(snapshot?.snapshotType === "FINAL" ? 4 : !snapshot ? 0 : answerCount < 3 ? 1 : 2) === index ? "step" : undefined}>{label}</li>)}</ol>
    {!snapshot && initialInterviewId && <p className={styles.notice}>{error ? "이 브라우저에서 저장된 인터뷰에 접근할 수 없습니다." : "저장된 인터뷰를 불러오는 중입니다."} <Link href="/judge-demo">새 합성 시연 시작</Link></p>}
    {!snapshot && !initialInterviewId && <section className={styles.judgeControls}><h2>기존 신용정보에는 사업자의 회복 이유와 실행 계획이 없습니다.</h2><p>가상의 골목카페가 매출·반복 고객·비용과 계획을 설명합니다. 직접 결과를 확인한 뒤 다음 답변을 보내세요.</p><label className={styles.consent}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />합성 답변과 현재 인터뷰 상태가 외부 AI(Anthropic)에 전송되는 것에 동의합니다. 실제 고객정보는 입력하지 않습니다.</label><button className={styles.primary} disabled={!consent || busy} onClick={() => void start()}>{busy ? "인터뷰 준비 중…" : "합성 사례로 인터뷰 시작"}<ArrowRight size={17} /></button></section>}
    {snapshot && !eligible && <p className={styles.notice}>이 기록은 3분 합성 대본의 사례가 아닙니다. <Link href={`/borrower/interviews/${snapshot.id}`}>기존 인터뷰에서 이어가기</Link></p>}
    {live && eligible && <section className={styles.judgeControls} aria-label="실제 AI 인터뷰"><p className={styles.eyebrow}>사업 정보 인터뷰</p><h2>{live.currentQuestion ?? "필수 질문 정리 완료"}</h2>{nextAnswer ? <><label htmlFor="judge-script">가상 사업자의 답변 {answerCount + 1} / 3</label><textarea id="judge-script" readOnly value={nextAnswer} /><button className={styles.primary} disabled={busy} onClick={() => void answer()}>{busy ? <><LoaderCircle size={17} className="spin" /> 답변을 정리하고 있습니다…</> : live.pendingCommand ? "저장된 답변 처리 이어가기" : "이 합성 답변 보내기"}</button></> : <><h3>3개 답변을 보냈습니다.</h3><p>아래에서 정리된 내용과 변수별 근거를 확인하세요. 묻지 않은 정보는 정보 부족으로 남습니다.</p></>}<Link href={`/borrower/interviews/${live.id}?mode=voice`}>음성·텍스트 인터뷰로 이어가기</Link></section>}
    {live && <p className={styles.small}>{connection === "OPEN" ? "변경 내용이 반영되고 있습니다." : "연결 상태를 확인하고 있습니다."}</p>}
    {live?.pendingCommand && !busy && <p className={styles.notice}>서버에 아직 처리 중인 답변이 있습니다. ‘저장된 답변 처리 이어가기’를 눌러 같은 요청을 다시 확인합니다. 이미 저장된 원문은 중복으로 추가하지 않습니다.</p>}
    {error && <div className={styles.notice} role="alert">{error}{snapshot && <button disabled={busy} onClick={() => void syncSnapshot().then(() => setError(null)).catch((error: Error) => setError(error.message))}>서버의 최신 상태 확인</button>}</div>}
    {snapshot && <DataReviewPanel interviewId={snapshot.snapshotType === "FINAL" ? snapshot.interviewId : snapshot.id} version={snapshot.version} onLoaded={reviewLoaded} />}
    {live && answerCount >= 3 && <section className={styles.resultActions}><h2>답변과 부족한 정보를 확인해 주세요.</h2><p>3개 답변에서 확인한 내용을 저장합니다. 미확인 항목은 그대로 남으며, 전체 질문을 마친 기록이나 품질 등급으로 처리하지 않습니다.</p><label className={styles.consent}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />원문·구조화 결과·누락 항목을 확인했습니다. 확인한 범위만 종료 기록으로 저장합니다.</label><button className={styles.primary} disabled={!confirmed || busy || Boolean(live.pendingCommand) || !review || review.version !== live.version} onClick={() => void finalize()}>결과 저장하고 다음 단계로 <ArrowRight size={17} /></button></section>}
    {snapshot?.snapshotType === "FINAL" && <section className={styles.resultActions}><h2>결과를 확인했다면 상담을 준비하세요.</h2><p>개선 계획을 선택하고 실행 내용을 남기거나, 지금 확인한 자료로 금융기관 상담을 준비할 수 있습니다.</p><div className={styles.actions}><Link href={`/recovery/${snapshot.interviewId}`}>개선 계획·실행 기록 <ArrowRight size={16} /></Link><Link href={`/demo/admin?interview=${snapshot.interviewId}`}>금융기관 검토자료</Link></div></section>}
    <EngineArchitecture /><p className={styles.small}>동행금융AI는 대출 승인·거절, 신용등급·승인 확률을 생성하지 않습니다.</p>
  </main>;
}
