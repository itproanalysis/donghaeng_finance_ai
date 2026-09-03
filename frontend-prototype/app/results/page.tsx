"use client";
import Link from "next/link";
import { useState } from "react";
import { FlowSteps, ServiceHeader } from "../components/ServiceNavigation";
import { QUEST_LABELS, proposalsFor } from "../lib/case-model";
import { useCases } from "../lib/case-store";
import { exportInterview } from "../lib/case-transfer";

export default function ResultsPage() {
  const { current: record, ready } = useCases();
  const [message, setMessage] = useState("");
  function downloadInterview() {
    if (!record) return;
    try {
      const url = URL.createObjectURL(
        new Blob([exportInterview(record)], {
          type: "application/json;charset=utf-8",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = "동행금융_인터뷰기록.json";
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(
        "인터뷰 기록을 내려받았습니다. 담당자는 관리자 화면에서 이 파일을 가져올 수 있어요.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "기록을 내려받지 못했습니다.",
      );
    }
  }
  return (
    <>
      <ServiceHeader />
      <main className="companion-page result-page">
        <FlowSteps active={2} />
        {!ready ? (
          <p role="status">확인한 답변을 불러오고 있어요.</p>
        ) : !record?.completedAt ? (
          <section className="companion-empty">
            <span>아직 이야기를 정리하는 중이에요.</span>
            <h1>
              인터뷰를 마치면,
              <br />
              다음 걸음이 보입니다.
            </h1>
            <p>
              입력한 답변을 직접 확인하고 완료해 주세요. 결과는 그 답변만으로
              정리합니다.
            </p>
            <Link className="companion-button" href="/demo">
              {record ? "인터뷰 이어가기" : "인터뷰 시작하기"} →
            </Link>
          </section>
        ) : (
          <>
            <section className="result-intro">
              <img
                src="/morning-cafe-recovered.png"
                alt="햇살 아래 다시 불을 밝힌 골목의 카페"
              />
              <div>
                <span className="companion-kicker">사장님이 확인한 이야기</span>
                <h1>
                  {record.businessName},<br />
                  여기서 다시 시작해요.
                </h1>
                <p>
                  {record.borrowerName || "사장"}님이 남긴 변화의 맥락과 준비할
                  자료를 모았어요. 작은 실행에서 다음 금융 상담까지 이어가
                  보세요.
                </p>
                <div className="result-counts">
                  <span>
                    <strong>{record.answers.length}</strong> 확인한 답변
                  </span>
                  <span>
                    <strong>{record.quests.filter(Boolean).length}</strong>{" "}
                    골목에서 남긴 생각
                  </span>
                  <span className="companion-tag">객관적 증빙은 확인 전</span>
                </div>
              </div>
            </section>
            <section className="companion-panel">
              <div className="section-title">
                <div>
                  <span className="companion-kicker">대화가 남긴 근거</span>
                  <h2>사장님의 말에서 시작합니다.</h2>
                </div>
                <span className="companion-tag">원문 그대로</span>
              </div>
              <div className="result-answer-grid">
                {record.answers.map((a, i) => (
                  <article key={a.questionId}>
                    <small>
                      질문 0{i + 1} ·{" "}
                      {a.revision > 1 ? "사장님 수정 답변" : "사장님 답변"}
                    </small>
                    <h3>{a.questionText}</h3>
                    <blockquote>{a.answerText}</blockquote>
                  </article>
                ))}
              </div>
              {record.quests.some(Boolean) && (
                <details className="result-quest-record">
                  <summary>골목에서 선택한 생각도 함께 보기</summary>
                  {record.quests.map(
                    (q, i) =>
                      q && (
                        <p key={i}>
                          <strong>{QUEST_LABELS[i]}</strong> {q}
                        </p>
                      ),
                  )}
                  <small>
                    사장님의 관심·준비 의향이며, 객관적 사실 확인을 대신하지
                    않습니다.
                  </small>
                </details>
              )}
            </section>
            <section className="result-next">
              <span className="companion-kicker">다음 동행</span>
              <h2>이런 걸음부터 함께 검토해요.</h2>
              <p>
                답변과 연결된 실행 후보입니다. 확정 목표나 예상 금융 성과가
                아닙니다.
              </p>
              <div className="result-mission-grid">
                {proposalsFor(record).map((p, i) => (
                  <article className="companion-panel" key={p.id}>
                    <span className="mission-number">0{i + 1}</span>
                    <h3>{p.title}</h3>
                    <p>{p.action}</p>
                    <small>근거 · {p.source}</small>
                  </article>
                ))}
              </div>
            </section>
            <section className="companion-handoff">
              <div>
                <span>사장님의 이야기를 담당자에게</span>
                <h2>같은 기록으로 다음 상담을 준비해요.</h2>
                <p>
                  관리자 화면에서 원문을 검토하고 개선안·담당자·점검일을 정리할
                  수 있어요. 다른 기기의 담당자에게는 인터뷰 기록 파일을 직접
                  전달해 주세요.
                </p>
              </div>
              <div className="companion-actions">
                <Link href="/admin" className="companion-button">
                  이 기기에서 관리자 검토 →
                </Link>
                <button
                  className="companion-button companion-button--light"
                  onClick={downloadInterview}
                >
                  담당자에게 전달할 기록 ↓
                </button>
              </div>
            </section>
            {message && (
              <p role="status" className="companion-status">
                {message}
              </p>
            )}
            <p className="companion-note">
              현재 기록은 이 브라우저에 저장되어 있습니다. 실제
              금액·신용점수·대출 가능성을 추정하지 않으며, 기관에 자동으로
              전송되지 않습니다.
            </p>
          </>
        )}
      </main>
    </>
  );
}
