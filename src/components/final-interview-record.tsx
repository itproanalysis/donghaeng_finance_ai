import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  Info,
  LockKeyhole,
} from "lucide-react";
import Link from "next/link";

import {
  formatDateTime,
  formatPercent,
  type FinalInterviewView,
} from "@/components/api-adapter";

export function FinalInterviewRecord({ snapshot }: { snapshot: FinalInterviewView }) {
  return (
    <main id="main-content" className="workspace-page final-record-page">
      <header className="final-record-hero">
        <div>
          <div className="workspace-heading__eyebrow">
            <span className="badge badge--final">FINAL</span>
            <span>불변 인터뷰 스냅샷</span>
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
            이 화면은 FINAL 원본을 표시합니다. 이후 PREVIEW 정보나 발화를 덮어쓰지 않으며,
            수정이 필요하면 별도 revision과 감사 이벤트가 필요합니다.
          </p>
        </div>
      </section>

      {snapshot.completionStatus === "INCOMPLETE" && (
        <section className="action-alert" role="status">
          <Info size={19} />
          <div>
            <strong>불완전 종료본에는 정식 인터뷰 보조평가를 생성하지 않습니다.</strong>
            <p>수집된 사실과 근거는 보존되지만 데이터 품질 등급은 UNGRADED입니다.</p>
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
          <small>0·unknown·refused·해당 없음을 구분</small>
        </article>
      </section>

      <section className="final-record-content">
        <div className="report-section-heading">
          <div>
            <p className="panel-kicker">FINAL INFORMATION</p>
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
                <span>{item.priority}</span>
                {item.verificationLabel && <span>{item.verificationLabel}</span>}
              </div>
            </article>
          ))}
        </div>
      </section>

      {snapshot.transcriptSummary && (
        <section className="live-summary-card">
          <div className="insight-heading">
            <div>
              <p className="panel-kicker">CITED BORROWER SUMMARY</p>
              <h2>차주 인터뷰 요약</h2>
            </div>
            <span className="badge badge--final">FINAL</span>
          </div>
          <p className="live-summary-card__text">{snapshot.transcriptSummary}</p>
        </section>
      )}

      <div className="final-record-actions">
        {snapshot.evaluationEligible && snapshot.evaluationId ? (
          <Link className="button button--primary" href={`/interview-evaluations/${encodeURIComponent(snapshot.evaluationId)}`}>
            <FileText size={17} /> 인터뷰 보조평가 보기
          </Link>
        ) : (
          <Link className="button button--ghost" href="/">
            새 인터뷰로 돌아가기
          </Link>
        )}
      </div>
    </main>
  );
}
