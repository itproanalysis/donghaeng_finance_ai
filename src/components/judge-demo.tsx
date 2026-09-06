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
  const answerCount = live?.transcript.filter((segment) => segment.speaker === "BORROWER").length ?? (snapshot?.snapshotType === "FINAL" ? 3 : 0);
  const eligible = !snapshot || (snapshot.businessName === JUDGE_DEMO.businessName && snapshot.borrowerName === JUDGE_DEMO.borrowerName);
  const nextAnswer = JUDGE_DEMO.answers[answerCount];
  const syncSnapshot = useCallback(async () => {
    if (!created.current) return;
    const next = adaptInterviewSnapshot(await readApiEnvelope(await authenticatedFetch(`/api/interviews/${created.current}`, { cache: "no-store" })));
    // A committed SSE batch can arrive before a failed HTTP response is retried.
    // Match this fixed, unique script turn to the persisted transcript before clearing its receipt.
    if (pending.current && next.snapshotType === "PREVIEW" && next.transcript.some((segment) => segment.speaker === "BORROWER" && (segment.rawText || segment.text) === pending.current?.text)) pending.current = null;
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
      pending.current ??= { clientMessageId: createClientCommandId("judge-answer"), text: nextAnswer, expectedVersion: live.version, currentQuestionInfoCode: live.currentQuestionInfoCode };
      const result = await post(`/api/interviews/${live.id}/messages`, pending.current);
      const telemetry = extractMessageProcessingTelemetry(result);
      if (telemetry && telemetry.status !== "APPLIED") throw new Error("서버가 답변 처리를 완료하지 못했습니다. 같은 요청을 다시 시도하거나 전체 인터뷰에서 확인해 주세요.");
      setSnapshot(adaptInterviewSnapshot(await readApiEnvelope(await authenticatedFetch(`/api/interviews/${live.id}`))));
      pending.current = null;
    } catch (error) { setError(error instanceof Error ? error.message : "답변 처리에 실패했습니다. 같은 답변을 다시 시도할 수 있습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  async function finalize() {
    if (!live || !confirmed || lock.current || pending.current) return;
    lock.current = true; setBusy(true); setError(null);
    try {
      finalCommand.current ??= { clientCommandId: createClientCommandId("judge-final"), expectedVersion: live.version, mode: "FORCE_INCOMPLETE", borrowerConfirmed: true, reason: "합성 기술 데모의 3개 답변으로 확인한 범위만 보존하며 미확인 항목을 포함해 종료함" };
      const data = await post(`/api/interviews/${live.id}/complete`, finalCommand.current);
      setSnapshot(adaptInterviewSnapshot(data));
    } catch (error) { setError(error instanceof Error ? error.message : "종료 기록을 저장하지 못했습니다."); }
    finally { lock.current = false; setBusy(false); }
  }
  return <main id="main-content" className={styles.page}>
    <header className={styles.judgeHeader}><div><p className={styles.eyebrow}>Competition Demo / Synthetic Data · 3분</p><h1>발화 한 문장이<br />검토 가능한 Feature가 됩니다.</h1><p>합성 답변을 실제 InterviewService에 전송합니다. 화면의 값·상태·Evidence는 서버 처리 결과입니다.</p></div><Link href="/about">서비스 소개</Link></header>
    <ol className={styles.judgeProgress} aria-label="심사 데모 흐름">{["0–20초 · 정보 공백", "20–70초 · 실제 인터뷰", "70–150초 · 원문·Feature", "150–170초 · 왜?", "170–180초 · 다음 행동"].map((label, index) => <li key={label} aria-current={(snapshot?.snapshotType === "FINAL" ? 4 : !snapshot ? 0 : answerCount < 3 ? 1 : 2) === index ? "step" : undefined}>{label}</li>)}</ol>
    {!snapshot && initialInterviewId && <p className={styles.notice}>{error ? "이 브라우저에서 저장된 인터뷰에 접근할 수 없습니다." : "저장된 인터뷰를 불러오는 중입니다."} <Link href="/judge-demo">새 합성 시연 시작</Link></p>}
    {!snapshot && !initialInterviewId && <section className={styles.judgeControls}><h2>기존 신용정보에는 사업자의 회복 이유와 실행 계획이 없습니다.</h2><p>가상의 골목카페가 매출·반복 고객·비용과 계획을 설명합니다. 직접 결과를 확인한 뒤 다음 답변을 보내세요.</p><label className={styles.consent}><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />합성 답변과 현재 인터뷰 상태가 외부 AI(Anthropic)에 전송되는 것에 동의합니다. 실제 고객정보는 입력하지 않습니다.</label><button className={styles.primary} disabled={!consent || busy} onClick={() => void start()}>{busy ? "인터뷰 준비 중…" : "합성 사례로 인터뷰 시작"}<ArrowRight size={17} /></button></section>}
    {snapshot && !eligible && <p className={styles.notice}>이 기록은 3분 합성 대본의 사례가 아닙니다. <Link href={`/borrower/interviews/${snapshot.id}`}>기존 인터뷰에서 이어가기</Link></p>}
    {live && eligible && <section className={styles.judgeControls} aria-label="실제 AI 인터뷰"><p className={styles.eyebrow}>AI INTERVIEW · TEXT / VOICE</p><h2>{live.currentQuestion ?? "필수 질문 정리 완료"}</h2>{nextAnswer ? <><label htmlFor="judge-script">가상 사업자의 답변 {answerCount + 1} / 3</label><textarea id="judge-script" readOnly value={nextAnswer} /><button className={styles.primary} disabled={busy} onClick={() => void answer()}>{busy ? <><LoaderCircle size={17} className="spin" /> 서버가 원문을 처리하고 있습니다…</> : "이 합성 답변 보내기"}</button></> : <><h3>3개 답변을 보냈습니다.</h3><p>아래에서 원문 → 구조화 → Feature → Signal을 따라가 보세요. 데모에서 묻지 않은 예약·생활비 등의 정보는 MISSING으로 남습니다.</p></>}<p className={styles.small}>AI 질문과 반응은 기존 오케스트레이터를 사용합니다. provider 지연·실패 시 결정론적 fallback으로 이어집니다.</p><Link href={`/borrower/interviews/${live.id}?mode=voice`}>실제 음성·텍스트 전체 인터뷰로 이어가기</Link></section>}
    {live && <p className={styles.small}>SSE · {connection === "OPEN" ? "연결됨 · 서버 batch 반영 후 갱신" : "연결 확인 중 · 응답 후 서버 상태를 다시 읽습니다."}</p>}
    {error && <div className={styles.notice} role="alert">{error}{snapshot && <button disabled={busy} onClick={() => void syncSnapshot().then(() => setError(null)).catch((error: Error) => setError(error.message))}>서버의 최신 상태 확인</button>}</div>}
    {snapshot && <DataReviewPanel interviewId={snapshot.snapshotType === "FINAL" ? snapshot.interviewId : snapshot.id} version={snapshot.version} onLoaded={reviewLoaded} />}
    {live && answerCount >= 3 && <section className={styles.resultActions}><h2>확인한 결과를 종료 기록으로 보존합니다.</h2><p>3분 데모는 전체 필수 질문을 마친 인터뷰가 아닙니다. 미확인 정보를 포함한 <strong>INCOMPLETE FINAL</strong>을 만들며 인터뷰 데이터 품질 등급을 생성하지 않습니다. Feature와 근거는 확인한 범위 그대로 보존합니다.</p><label className={styles.consent}><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />원문·구조화 결과·누락 항목을 확인했습니다. 확인한 범위만 종료 기록으로 저장합니다.</label><button className={styles.primary} disabled={!confirmed || busy || !review || review.version !== live.version} onClick={() => void finalize()}>확인한 범위로 FINAL 저장 <ArrowRight size={17} /></button></section>}
    {snapshot?.snapshotType === "FINAL" && <section className={styles.resultActions}><h2>분석 이후, 다음 행동을 직접 선택합니다.</h2><p>새 실행기록은 향후 재평가 시 Evidence로 활용될 수 있습니다.</p><div className={styles.actions}><Link href={`/recovery/${snapshot.interviewId}`}>개선 Action 선택 · Recovery Journey <ArrowRight size={16} /></Link><Link href={`/review/${snapshot.interviewId}`}>금융기관 검토 화면</Link></div></section>}
    <EngineArchitecture /><p className={styles.scope}>점수 밖의 사업 이야기를, 금융기관이 검토할 수 있는 데이터로 바꿉니다.</p><p className={styles.small}>동행금융AI는 대출 승인·거절, 신용등급·승인 확률을 생성하지 않습니다.</p>
  </main>;
}
