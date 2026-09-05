"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Compass,
  Copy,
  FileCheck2,
  Headphones,
  RotateCcw,
  User,
  Users,
} from "lucide-react";
import { MosaicCurtain } from "@/components/mosaic-curtain";

interface QuestionStep {
  title: string;
  heard: string;
  question: string;
  audioSrc: string;
  options: string[];
  evidenceTitle: string;
  evidenceDesc: string;
}

const steps: QuestionStep[] = [
  {
    title: "상황을 말로 풀어내기",
    heard: "매출 변화 · 사업 공백의 이유",
    question: "최근 매출이 달라진 가장 큰 이유를 들려주세요.",
    audioSrc: "/audio/yujin-q1.wav",
    options: ["리뉴얼 후 다시 영업을 시작했어요.", "새로운 납품 계약이 생겼어요."],
    evidenceTitle: "변화 원인 요약",
    evidenceDesc: "휴업 후 시설 리뉴얼 완료 및 영업 재개. 단골 고객 복귀로 최근 3개월 매출 회복세 형성.",
  },
  {
    title: "현금흐름 습관 만들기",
    heard: "현재 매출 · 고정비 · 조정 가능한 지출",
    question: "그 변화가 지금도 이어지고 있나요?",
    audioSrc: "/audio/yujin-q2.wav",
    options: ["최근 3개월 매출이 안정됐어요.", "단골 고객과 주문이 다시 늘었어요."],
    evidenceTitle: "첫 행동 목표",
    evidenceDesc: "원재료비와 불필요한 카드 지출 우선 조정. 월 70만 원 잉여 자금 확보 및 상환 재원 마련.",
  },
  {
    title: "상담 자료 준비하기",
    heard: "실행 기록 · 준비 가능한 증빙",
    question: "다음 금융 검토를 위해 먼저 준비할 수 있는 자료는 무엇인가요?",
    audioSrc: "/audio/yujin-q3.wav",
    options: ["최근 매출 정산 자료를 준비할 수 있어요.", "상환 계획을 다시 확인할 수 있어요."],
    evidenceTitle: "상담 준비 근거",
    evidenceDesc: "최근 3개월 카드 매출 정산서 및 임대차 계약서 사전 구비. 금융기관 상담 시 소명 자료 제출 준비.",
  },
];

export function AlleyDialogueInterview() {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>([]);
  const [customText, setCustomText] = useState("");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [viewMode, setViewMode] = useState<"borrower" | "admin">("borrower");
  const [copied, setCopied] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeStep = steps[stepIndex] ?? steps[0]!;

  useEffect(() => {
    return () => {
      audioRef.current?.pause();
    };
  }, []);

  function playVoice(src: string) {
    audioRef.current?.pause();
    setIsPlayingAudio(true);
    const audio = new Audio(src);
    audioRef.current = audio;
    audio.onended = () => setIsPlayingAudio(false);
    audio.onerror = () => setIsPlayingAudio(false);
    void audio.play().catch(() => setIsPlayingAudio(false));
  }

  function handleChoice(text: string) {
    const nextAnswers = [...answers, text];
    setAnswers(nextAnswers);
    setCustomText("");

    if (stepIndex >= steps.length - 1) {
      setIsCompleted(true);
    } else {
      const next = stepIndex + 1;
      setStepIndex(next);
      window.setTimeout(() => {
        playVoice(steps[next]!.audioSrc);
      }, 150);
    }
  }

  function handleCustomSubmit() {
    if (!customText.trim()) return;
    handleChoice(customText.trim());
  }

  function handleRestart() {
    setStepIndex(0);
    setAnswers([]);
    setCustomText("");
    setIsCompleted(false);
    setViewMode("borrower");
  }

  function handleCopy() {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="alley-dialogue-screen">
      <header className="alley-dialogue-topbar">
        <Link href="/" className="alley-dialogue-brand" aria-label="동행금융 처음으로">
          동행금융
        </Link>
        <div className="alley-dialogue-status">
          {isCompleted
            ? "회복 근거 3 / 3 수집 완료 · 장부 작성됨"
            : `걸음 ${stepIndex + 1} / ${steps.length} · ${activeStep.title}`}
        </div>
        <Link href="/" className="alley-dialogue-exit">
          <ArrowLeft size={14} /> 골목길로 돌아가기
        </Link>
      </header>

      <main className="alley-dialogue-stage">
        {!isCompleted ? (
          <section className="alley-dialogue-card" aria-label="동행 대화">
            <span className="alley-dialogue-badge">
              <Compass size={14} /> 따뜻한 동행가게 · 대화의 시간
            </span>

            <h1 className="alley-dialogue-question">
              “{activeStep.question}”
            </h1>

            <button
              type="button"
              className="alley-dialogue-voice-btn"
              onClick={() => playVoice(activeStep.audioSrc)}
              disabled={isPlayingAudio}
            >
              <Headphones size={15} />
              {isPlayingAudio ? "동행자가 이야기하는 중..." : "동행자 목소리로 질문 듣기"}
            </button>

            <div className="alley-dialogue-choices">
              {activeStep.options.map((option, idx) => (
                <button
                  key={option}
                  type="button"
                  className="alley-dialogue-choice-btn"
                  onClick={() => handleChoice(option)}
                >
                  <span className="alley-dialogue-choice-num">{idx + 1}</span>
                  <span>{option}</span>
                </button>
              ))}
            </div>

            <div className="alley-dialogue-input-box">
              <textarea
                value={customText}
                onChange={(e) => setCustomText(e.target.value)}
                placeholder="직접 사장님의 상황을 편안하게 적어주셔도 좋아요."
                rows={1}
              />
              <button
                type="button"
                onClick={handleCustomSubmit}
                disabled={!customText.trim()}
              >
                답변 남기기
              </button>
            </div>

            <footer className="alley-dialogue-footer">
              <div className="alley-dialogue-steps">
                {steps.map((s, idx) => {
                  const isDone = idx < stepIndex;
                  const isActive = idx === stepIndex;
                  return (
                    <span
                      key={s.title}
                      className={`alley-dialogue-step-node${isActive ? " is-active" : ""}${isDone ? " is-done" : ""}`}
                    >
                      {isDone ? <CheckCircle2 size={12} /> : null}
                      0{idx + 1} {s.evidenceTitle}
                    </span>
                  );
                })}
              </div>
              <small style={{ color: "var(--text-muted)", fontSize: "12px" }}>
                이야기를 경청하고 3가지 회복 근거로 정돈합니다.
              </small>
            </footer>
          </section>
        ) : (
          /* =========================================================================
             The Dawn Recovery Ledger (새벽 골목길 회복 장부)
             ========================================================================= */
          <section className="alley-ledger-card" aria-label="새벽 골목길 회복 장부">
            <header className="alley-ledger-header">
              <div>
                <span className="alley-dialogue-badge">
                  <CheckCircle2 size={14} /> 회복의 세 걸음 완성
                </span>
                <h2>동행카페 사장님, 함께 엮어낸 회복 장부입니다.</h2>
              </div>
              <div className="alley-ledger-tabs">
                <button
                  type="button"
                  className={`alley-ledger-tab-btn ${viewMode === "borrower" ? "is-active" : ""}`}
                  onClick={() => setViewMode("borrower")}
                >
                  <User size={13} style={{ display: "inline", marginRight: "4px" }} /> 사장님의 길
                </button>
                <button
                  type="button"
                  className={`alley-ledger-tab-btn ${viewMode === "admin" ? "is-active" : ""}`}
                  onClick={() => setViewMode("admin")}
                >
                  <Users size={13} style={{ display: "inline", marginRight: "4px" }} /> 심사역 검토 서류
                </button>
              </div>
            </header>

            <p style={{ margin: "0 0 24px", color: "var(--text-soft)", fontSize: "14px", lineHeight: "1.6" }}>
              {viewMode === "borrower"
                ? "점수나 등급 대신 사장님의 소중한 사업 이야기에서 출발해, 다음 금융 상담 전까지 실천할 수 있는 세 가지 회복 약속을 정리했습니다."
                : "단순 연체나 매출 감소 뒤에 가려졌던 사업 회복 맥락과 구체적 지출 조정 의지가 금융기관 상담용 검토 근거로 구비되었습니다."}
            </p>

            <div className="alley-ledger-grid">
              {steps.map((s, idx) => (
                <article key={s.title} className="alley-ledger-pillar">
                  <small>걸음 0{idx + 1} · {s.evidenceTitle}</small>
                  <h3>{s.title}</h3>
                  <div
                    style={{
                      background: "rgba(242, 196, 111, 0.12)",
                      borderLeft: "3px solid var(--route-gold)",
                      padding: "10px 12px",
                      borderRadius: "0 8px 8px 0",
                      margin: "8px 0 12px",
                    }}
                  >
                    <p style={{ margin: 0, fontSize: "13px", color: "var(--forest-ink)", fontStyle: "italic" }}>
                      “{answers[idx] ?? s.options[0]}”
                    </p>
                  </div>
                  <strong>
                    {viewMode === "borrower" ? `실천 과제: ${s.evidenceDesc}` : `심사 근거: ${s.evidenceDesc}`}
                  </strong>
                </article>
              ))}
            </div>

            <footer className="alley-ledger-actions">
              <button
                type="button"
                className="dh-button dh-button--light"
                onClick={handleRestart}
              >
                <RotateCcw size={15} /> 대화 다시 시작하기
              </button>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  type="button"
                  className="dh-button dh-button--light"
                  onClick={handleCopy}
                >
                  <Copy size={15} /> {copied ? "복사 완료!" : "상담 요약서 복사"}
                </button>
                <Link href="/demo/admin" className="dh-button">
                  <FileCheck2 size={15} /> 금융기관 검토실 전체 보기 <ArrowRight size={15} />
                </Link>
              </div>
            </footer>
          </section>
        )}
      </main>

      <MosaicCurtain mode="reveal" />
    </div>
  );
}

export default AlleyDialogueInterview;
