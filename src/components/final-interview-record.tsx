import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  LockKeyhole,
} from "lucide-react";
import Link from "next/link";
import { ADMIN_JOURNEY, JourneyNav } from "@/components/journey-nav";
import { ConsultationMemoExport } from "@/components/consultation-memo-export";
import { linkedConsultationEvidence } from "@/components/consultation-memo";
import { readableInformationText } from "@/components/operator-language";

import {
  formatDateTime,
  formatPercent,
  type FinalInterviewView,
} from "@/components/api-adapter";

export function FinalInterviewRecord({ snapshot }: { snapshot: FinalInterviewView }) {
  return (
    <main id="main-content" className="workspace-page final-record-page">
      <JourneyNav steps={ADMIN_JOURNEY} current={0} label="관리자 업무 전체 흐름" />
      <Link className="service-back-link" href="/interviews">← 상담 대장</Link>
      <header className="final-record-hero">
        <div>
          <div className="workspace-heading__eyebrow">
            <span className="badge badge--final">종료 기록</span>
            <span>종료 시점에 확정한 인터뷰</span>
          </div>
          <h1>{snapshot.businessName}</h1>
          <p>
            {snapshot.borrowerName} · {snapshot.industry} · v{snapshot.version} · {formatDateTime(snapshot.finalizedAt)}
          </p>
        </div>
        <div className="final-record-hero__status" data-status={snapshot.completionStatus.toLowerCase()}>
          {snapshot.completionStatus === "COMPLETE" ? (
            <CheckCircle2 size={20} />
          ) : (
            <AlertTriangle size={20} />
          )}
          <span>
            종료 상태
            <strong>{snapshot.completionStatus === "COMPLETE" ? "완료" : "강제 중단·불완전"}</strong>
          </span>
        </div>
      </header>

      <section className="final-boundary-card">
        <LockKeyhole size={21} aria-hidden="true" />
        <div>
          <strong>종료 시점의 기록으로 고정되었습니다.</strong>
          <p>
            종료할 때 저장한 원본입니다. 이후의 메모나 상담 준비 내용이 원본 답변을 바꾸지 않습니다.
          </p>
        </div>
      </section>
      <ConsultationMemoExport snapshot={snapshot} />

      {snapshot.completionStatus === "INCOMPLETE" && (
        <section className="action-alert" role="status">
          <Info size={19} />
          <div>
            <strong>불완전 종료본에는 정식 인터뷰 보조평가를 생성하지 않습니다.</strong>
            <p>수집한 답변과 근거는 보존되며, 미확인 항목을 포함한 상담 메모를 받을 수 있습니다. 데이터 품질 등급은 부여하지 않습니다.</p>
          </div>
        </section>
      )}

      <section className="final-record-summary">
        <article>
          <span>최종 정보 충족률</span>
          <strong>{formatPercent(snapshot.overallRate)}</strong>
          <small>신용점수 또는 승인 가능성이 아닙니다.</small>
        </article>
        <article>
          <span>근거 연결</span>
          <strong>{snapshot.evidence.length}개</strong>
          <small>원천 발화·기존 자료·시스템 산출 근거</small>
        </article>
        <article>
          <span>정보 항목</span>
          <strong>{snapshot.informationItems.length}개</strong>
          <small>0·모름·답변 거절·해당 없음을 구분</small>
        </article>
      </section>

      <section className="final-record-content">
        <div className="report-section-heading">
          <div>
              <p className="panel-kicker">종료 기록</p>
            <h2>확정 정보와 종결 상태</h2>
          </div>
        </div>
        <div className="final-information-grid">
          {snapshot.informationItems.map((item) => (
            <article className="information-card" data-state={item.status.toLowerCase()} key={item.infoCode}>
              <div className="information-card__heading">
                <strong>{item.label}</strong>
                <span className="state-label" data-state={item.status.toLowerCase()}>{item.statusLabel}</span>
              </div>
              <p className="information-card__value">{item.displayValue ?? item.valueStateLabel}</p>
              <div className="information-card__meta">
                <span>{item.categoryLabel}</span>
                <span>{item.required ? "필수 확인 범위" : "참고 확인 범위"}</span>
                {item.verificationLabel && <span>{item.verificationLabel}</span>}
              </div>
              <details className="final-item-evidence">
                <summary>이 내용의 연결 근거 {linkedConsultationEvidence(item, snapshot.evidence).length}개</summary>
                {linkedConsultationEvidence(item, snapshot.evidence).length ? linkedConsultationEvidence(item, snapshot.evidence).map((entry) => (
                  <blockquote key={entry.id}>
                    <p>{entry.excerpt ?? entry.linkedTranscript?.text ?? "원문이 포함되지 않았습니다."}</p>
                    <small>{entry.kindLabel} · {entry.source}</small>
                  </blockquote>
                )) : <p>연결된 근거가 없습니다. 별도 자료 확인이 필요합니다.</p>}
              </details>
            </article>
          ))}
        </div>
      </section>

      {snapshot.transcriptSummary && (
        <section className="live-summary-card">
          <div className="insight-heading">
            <div>
              <p className="panel-kicker">원문 기반 요약</p>
              <h2>사장님 인터뷰 요약</h2>
            </div>
            <span className="badge badge--final">종료 기록</span>
          </div>
          <p className="live-summary-card__text">{readableInformationText(snapshot.transcriptSummary, snapshot.informationItems)}</p>
          <small>종료 당시 저장된 요약입니다. 답변을 보류한 항목은 반드시 다시 질문해야 한다는 뜻이 아닙니다.</small>
        </section>
      )}

      <div className="final-record-actions">
        {snapshot.evaluationEligible && snapshot.evaluationId ? (
          <Link className="button button--primary" href={`/interview-evaluations/${encodeURIComponent(snapshot.evaluationId)}`}>
            <FileText size={17} /> 인터뷰 보조평가 보기
          </Link>
        ) : (
          <Link className="button button--ghost" href="/interviews">
            상담소에서 다른 기록 확인하기
          </Link>
        )}
      </div>
    </main>
  );
}
