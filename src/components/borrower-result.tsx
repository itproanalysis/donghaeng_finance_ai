"use client";

import { ArrowRight, CheckCircle2, FileText } from "lucide-react";
import Link from "next/link";
import type { FinalInterviewView } from "@/components/api-adapter";
import { buildImprovementCandidates } from "@/components/borrower-immersive-prompts";
import { BORROWER_JOURNEY, JourneyNav } from "@/components/journey-nav";
import { LiveModelingScorecard } from "@/components/live-modeling-scorecard";
import { OPERATING_DAY_DEMO_SCENARIO } from "@/domain/demo-scenario";
import { ConsultationMemoExport } from "@/components/consultation-memo-export";
import { groupConsultationInformation, linkedConsultationEvidence } from "@/components/consultation-memo";

export function BorrowerResult({ snapshot }: { snapshot: FinalInterviewView }) {
  const { confirmed, deferred, followUp: remaining } = groupConsultationInformation(snapshot.informationItems);
  const candidates = buildImprovementCandidates({
    informationItems: snapshot.informationItems,
    goal: snapshot.goal ?? null,
  });
  return (
    <main id="main-content" className="dh-page borrower-result">
      <JourneyNav
        steps={BORROWER_JOURNEY}
        current={3}
        label="사장님 인터뷰 결과"
      />
      <section className="result-banner">
        <CheckCircle2 size={36} />
        <div>
          <span>인터뷰 기록 저장</span>
          <h1>{snapshot.businessName} 인터뷰 기록</h1>
          <p>
            {snapshot.borrowerName}님이 확인한 답변과 다음 상담에서 검토할 내용입니다.
          </p>
        </div>
      </section>
      {snapshot.evaluationId && snapshot.businessName === OPERATING_DAY_DEMO_SCENARIO.persona.businessName && snapshot.borrowerName === OPERATING_DAY_DEMO_SCENARIO.persona.borrowerName && <section className="dh-panel"><LiveModelingScorecard key={snapshot.evaluationId} evaluationId={snapshot.evaluationId} /><Link href={`/interview-evaluations/${encodeURIComponent(snapshot.evaluationId)}`}>담당자 검토 화면 보기</Link></section>}
      <ConsultationMemoExport snapshot={snapshot} />
      {snapshot.completionStatus === "INCOMPLETE" && (
        <div className="dh-inline-note">
          <FileText size={20} />
          <p>
            확인하지 못한 항목을 포함해 인터뷰를 마쳤어요. 이 기록으로는 데이터
            품질 평가를 만들지 않습니다. 빈 항목은 아래에서 확인할 수 있어요.
          </p>
        </div>
      )}
      <div className="dh-two-columns">
        <section className="dh-panel">
          <h2>확인한 사업 정보</h2>
          <p>인터뷰에서 확인한 값입니다. 증빙 확인 여부는 각 항목의 출처를 함께 살펴봐 주세요.</p>
          <dl className="result-facts">
            {confirmed.map((i) => (
              <div key={i.id}>
                <dt>{i.label}</dt>
                <dd>
                  {i.displayValue ?? "표시할 값 없음"}
                  <small>
                    {linkedConsultationEvidence(i, snapshot.evidence).length}개 연결 근거 ·{" "}
                    {i.verificationLabel ?? i.statusLabel}
                  </small>
                </dd>
              </div>
            ))}
          </dl>
          {!confirmed.length && (
            <p>
              확인된 사업 정보가 없습니다. 아래 기록에서 응답 상태를 확인해
              주세요.
            </p>
          )}
        </section>
        <section className="dh-panel">
          <h2>상담에서 검토할 개선안</h2>
          <p>
            확인한 답변에 따른 후보와 일반적인 참고 제안을 구분해 표시합니다. 선택이나 실행은 의무가 아닙니다.
          </p>
          <div className="result-proposals">
            {candidates.map((c) => (
              <article key={c.id}>
                <span className="dh-tag">{c.origin === "CATALOG_SUGGESTION" ? "일반 참고 제안" : "답변 기반 후보"} · 미확정</span>
                <h3>{c.title}</h3>
                <p>{c.description}</p>
                <small>{c.origin === "CATALOG_SUGGESTION" ? "개별 사업 성과를 예측한 제안이 아닙니다." : c.sourceLabel}</small>
              </article>
            ))}
          </div>
        </section>
      </div>
      {remaining.length > 0 && (
        <section className="dh-panel">
          <h2>아직 확인이 필요한 내용</h2>
          <ul className="result-gaps">
            {remaining.map((i) => (
              <li key={i.id}>
                <strong>{i.label}</strong>
                <span>{i.statusLabel}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {deferred.length > 0 && (
        <section className="dh-panel">
          <h2>답변을 보류한 내용</h2>
          <p>모르거나 답하기 어려워 이 항목의 질문을 마쳤어요. 원하지 않으면 다시 답하지 않아도 됩니다.</p>
          <ul className="result-gaps">
            {deferred.map((item) => <li key={item.id}><strong>{item.label}</strong><span>{item.statusLabel}</span></li>)}
          </ul>
        </section>
      )}
      <details className="dh-panel answer-history">
        <summary>
          내 답변의 연결 근거 확인하기 · {snapshot.evidence.length}개
        </summary>
        {snapshot.evidence.length ? (
          snapshot.evidence.map((e) => (
            <article key={e.id}>
              <strong>
                {snapshot.informationItems.find(
                  (i) => i.infoCode === e.infoCode,
                )?.label ?? "인터뷰 근거"}
              </strong>
              <p>
                {e.excerpt ??
                  e.linkedTranscript?.text ??
                  "연결된 원문이 없습니다."}
              </p>
              <small>
                {e.kindLabel} · {e.source}
              </small>
            </article>
          ))
        ) : (
          <p>표시할 연결 근거가 없습니다.</p>
        )}
      </details>
      <section className="consultation-handoff">
        <div>
          <h2>다음 상담에서 확인할 자료</h2>
          <p>
            담당자와 답변·목표·준비자료를 검토할 때 이 기록을 사용할 수 있습니다.
          </p>
        </div>
        <Link className="dh-button" href="/borrower">새 인터뷰 시작 <ArrowRight size={17} /></Link>
      </section>
      <p className="dh-footnote">
        이 결과는 인터뷰에서 확인한 내용입니다. 대출 승인·거절이나 신용등급을
        뜻하지 않으며, 금융기관에 자동으로 전달되지 않습니다.
      </p>
    </main>
  );
}
