"use client";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  MessageCircleHeart,
  RotateCcw,
  Send,
  Sprout,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { BusinessMap, DemoNotice } from "@/components/demo-shared";
import { BORROWER_JOURNEY, JourneyNav } from "@/components/journey-nav";
import {
  DEMO_QUESTIONS,
  demoImprovement,
  demoMetrics,
  money,
  type DemoSession,
} from "@/domain/service-demo";
import { useDemoSession } from "@/components/use-demo-session";

export function BorrowerDemo() {
  const {
    session,
    ready,
    storageError,
    update: saveSession,
  } = useDemoSession();
  const [choice, setChoice] = useState<number | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [showReset, setShowReset] = useState(false);
  function update(next: DemoSession) {
    saveSession(next);
    setChoice(null);
    setConfirmed(false);
  }
  const step = session.answers.length;
  const question = DEMO_QUESTIONS[step];
  const metrics = demoMetrics(session.answers);
  const plan = demoImprovement(session.answers);

  return (
    <main id="main-content" className="dh-page">
      <DemoNotice other="admin" />
      <div className="dh-page-heading">
        <div>
          <span className="dh-eyebrow">FLOW 01 · 사장님의 동행</span>
          <h1>
            {session.completed
              ? "우리 가게 이야기가 정리됐어요."
              : "편한 이야기부터 시작해요."}
          </h1>
          <p>
            {session.completed
              ? "내가 확인한 내용에서, 다음에 해볼 일까지 함께 살펴봐요."
              : "동행카페 사장님이 되어 예시 답변을 골라 보세요. 선택에 따라 결과가 달라집니다."}
          </p>
        </div>
        <button
          type="button"
          className="dh-button dh-button--light"
          onClick={() => setShowReset(!showReset)}
        >
          <RotateCcw size={16} /> 처음부터
        </button>
      </div>
      {showReset && (
        <div className="dh-inline-note" role="alert">
          <span>이 탭의 예시 답변과 완료 상태를 초기화할까요?</span>
          <button
            className="dh-button"
            onClick={() => {
              update({ answers: [], completed: false });
              setShowReset(false);
            }}
          >
            초기화하기
          </button>
          <button
            className="dh-button dh-button--light"
            onClick={() => setShowReset(false)}
          >
            취소
          </button>
        </div>
      )}
      {storageError && (
        <p role="status">
          브라우저 저장소를 사용할 수 없어 다른 화면으로 이동하면 진행 내용이
          유지되지 않을 수 있어요.
        </p>
      )}
      <JourneyNav
        steps={BORROWER_JOURNEY}
        current={session.completed ? 3 : step === 6 ? 2 : step === 0 ? 0 : 1}
        label="사장님 체험 진행"
      />
      {!ready ? (
        <p role="status">이 탭의 진행 내용을 확인하고 있어요.</p>
      ) : session.completed ? (
        <>
          <section className="result-banner">
            <CheckCircle2 size={36} />
            <div>
              <span>답변 확인 완료 · 가상 사례</span>
              <h2>동행카페, 지금 여기서 시작해요.</h2>
              <p>아래 금액은 예시 답변으로 계산한 월 자금 흐름이에요.</p>
            </div>
            <Link href="/demo/admin" className="dh-button dh-button--white">
              이 결과를 관리자와 살펴보기 <ArrowRight size={18} />
            </Link>
          </section>
          <div className="dh-metrics">
            {[
              { label: "월평균 매출", value: metrics.sales },
              {
                label: "재료비 + 고정비",
                value: metrics.materials! + metrics.fixed!,
              },
              { label: "월 상환액", value: metrics.repayment },
              { label: "단순 잔여 자금", value: metrics.available },
            ].map((x) => (
              <article key={x.label}>
                <span>{x.label}</span>
                <strong>{money(x.value)}</strong>
              </article>
            ))}
          </div>
          <p className="dh-footnote">
            단순 잔여 자금 = 매출 − 재료비 − 고정비 − 상환액. 세금·가계비·기타
            지출을 반영하지 않은 예시이며 실제 가용자금과 다를 수 있어요.
          </p>
          <div className="dh-two-columns">
            <BusinessMap answers={session.answers} />
            <section className="dh-panel next-companion">
              <span className="dh-icon dh-icon--teal">
                <Sprout size={24} />
              </span>
              <span className="dh-eyebrow">다음에 함께 해볼 일</span>
              <h2>{plan.title}</h2>
              <p>{plan.reason}</p>
              <ol className="dh-action-list">
                <li>
                  <strong>작게 시작하기</strong>
                  <span>{plan.action}</span>
                </li>
                <li>
                  <strong>기록으로 확인하기</strong>
                  <span>{plan.evidence}</span>
                </li>
                <li>
                  <strong>상담 준비하기</strong>
                  <span>
                    {DEMO_QUESTIONS[5]!.options[session.answers[5]!]!.short}.
                    담당자가 자료와 상담 경로를 검토합니다.
                  </span>
                </li>
              </ol>
              <span className="dh-tag">아직 확정하지 않은 개선 후보</span>
            </section>
          </div>
          <details className="dh-panel answer-history">
            <summary>내가 선택한 답변 다시 보기 · 6개</summary>
            {DEMO_QUESTIONS.map((q, i) => (
              <div key={q.label}>
                <strong>
                  {i + 1}. {q.question}
                </strong>
                <p>{q.options[session.answers[i]!]!.text}</p>
              </div>
            ))}
          </details>
        </>
      ) : (
        <div className="dh-two-columns borrower-demo-layout">
          <section className="dh-panel interview-demo" aria-label="인터뷰 체험">
            {question ? (
              <>
                <div className="interview-demo__top">
                  <span>
                    <MessageCircleHeart size={18} /> 동행 AI
                  </span>
                  <small>질문 {step + 1} / 6</small>
                </div>
                <div className="interview-demo__question" aria-live="polite">
                  <span className="dh-tag">{question.label}</span>
                  <h2>{question.question}</h2>
                  <p>{question.why}</p>
                </div>
                <fieldset className="demo-answer-options">
                  <legend>사장님의 예시 답변을 선택해 주세요</legend>
                  {question.options.map((o, i) => (
                    <label key={o.text} data-selected={choice === i}>
                      <input
                        type="radio"
                        name={`answer-${step}`}
                        checked={choice === i}
                        onChange={() => setChoice(i)}
                      />
                      <span>{o.text}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="interview-demo__actions">
                  <button
                    className="dh-button dh-button--light"
                    disabled={step === 0}
                    onClick={() =>
                      update({
                        answers: session.answers.slice(0, -1),
                        completed: false,
                      })
                    }
                  >
                    <ArrowLeft size={16} /> 이전 답변
                  </button>
                  <button
                    className="dh-button"
                    disabled={choice === null}
                    onClick={() => {
                      if (choice !== null)
                        update({
                          answers: [...session.answers, choice],
                          completed: false,
                        });
                    }}
                  >
                    답변 보내기 <Send size={16} />
                  </button>
                </div>
                <p className="dh-footnote">
                  체험은 정해진 예시 답변을 사용합니다. 실시간 AI·마이크 연결은
                  하지 않습니다.
                </p>
              </>
            ) : (
              <>
                <span className="dh-icon dh-icon--teal">
                  <CheckCircle2 size={26} />
                </span>
                <h2>마지막으로 이야기 내용을 확인해 주세요.</h2>
                <p>
                  선택한 여섯 가지 답변이 오른쪽 사업 지도에 정리됐어요. 확인을
                  마치면 결과와 개선 후보를 보여드려요.
                </p>
                <label className="dh-checkbox">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{" "}
                  정리된 예시 답변을 확인했어요.
                </label>
                <div className="interview-demo__actions">
                  <button
                    className="dh-button dh-button--light"
                    onClick={() =>
                      update({
                        answers: session.answers.slice(0, -1),
                        completed: false,
                      })
                    }
                  >
                    마지막 답변 수정
                  </button>
                  <button
                    className="dh-button"
                    disabled={!confirmed}
                    onClick={() => update({ ...session, completed: true })}
                  >
                    내 사업 결과 보기 <ArrowRight size={17} />
                  </button>
                </div>
              </>
            )}
          </section>
          <BusinessMap answers={session.answers} />
        </div>
      )}
    </main>
  );
}
