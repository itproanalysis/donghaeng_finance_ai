"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, CheckCircle2, Copy, RotateCcw } from "lucide-react";

const AlleyHopeJourney = lazy(() =>
  import("@/components/alley-hope-journey").then((mod) => ({ default: mod.AlleyHopeJourney })),
);

export interface MissionQuest {
  title: string;
  heard: string;
  outcome: string;
  quest: string;
  question: string;
  choices: string[];
  reward: string;
}

export const missions: MissionQuest[] = [
  {
    title: "상황을 말로 풀어내기",
    heard: "매출 변화 · 사업 공백의 이유",
    outcome: "상황과 변화 원인을 한 문장으로",
    quest: "사업 공백의 이유",
    question: "최근 매출이 달라진 가장 큰 이유는 무엇인가요?",
    choices: [
      "거리 유동인구와 단골 손님이 줄어 매출이 정체되었어요.",
      "가게 리뉴얼과 새 메뉴 개발로 다시 매출이 오르고 있어요.",
      "원자재비와 배달 수수료 등 지출이 늘어 이익이 줄었어요.",
    ],
    reward: "매출 회복 맥락 확인",
  },
  {
    title: "현금흐름 습관 만들기",
    heard: "현재 매출 · 고정비 · 카드 지출",
    outcome: "오늘 실행할 수 있는 지출 목표",
    quest: "조정 가능한 지출",
    question: "지금 가장 먼저 조정해볼 수 있는 지출 항목은 무엇인가요?",
    choices: [
      "불필요한 구독과 통신비, 공과금부터 줄여볼 수 있어요.",
      "재료 발주량을 정밀하게 맞춰 식자재 폐기율을 낮출 수 있어요.",
      "단골 손님 쿠폰과 지역 홍보로 재방문 매출을 먼저 만들게요.",
    ],
    reward: "지출 개선 의지 확보",
  },
  {
    title: "상담 자료 준비하기",
    heard: "실행 기록 · 준비 가능한 증빙",
    outcome: "금융기관이 다시 검토할 자료",
    quest: "준비 가능한 증빙",
    question: "다음 금융 상담 전에 준비할 수 있는 자료는 무엇인가요?",
    choices: [
      "최근 3개월 카드 매출 정산 내역과 입출금 통장을 준비할게요.",
      "월 고정비 지출 내역과 성실 납부 영수증을 모아둘 수 있어요.",
      "현실적인 월 상환 계획표와 가게 운영 일지를 작성해 둘게요.",
    ],
    reward: "상담 준비 근거 완성",
  },
];

interface AlleyRoadHomeProps {
  initialView?: "road" | "ledger" | "admin";
}

export function AlleyRoadHome({ initialView = "road" }: AlleyRoadHomeProps) {
  const [mission, setMission] = useState(0);
  const [progress, setProgress] = useState(initialView === "admin" ? 0.95 : 0);
  const [isQuestOpen, setIsQuestOpen] = useState(false);
  const [customInput, setCustomInput] = useState("");
  const [answers, setAnswers] = useState<Array<string | null>>(() =>
    initialView === "admin"
      ? [missions[0].choices[1]!, missions[1].choices[0]!, missions[2].choices[0]!]
      : [null, null, null],
  );
  const [reward, setReward] = useState<string | null>(null);
  const [isLedgerOpen, setIsLedgerOpen] = useState(initialView === "admin");
  const [ledgerTab, setLedgerTab] = useState<"borrower" | "admin">(initialView === "admin" ? "admin" : "borrower");
  const [copied, setCopied] = useState(false);

  const answersRef = useRef(answers);
  const rewardTimerRef = useRef<number | null>(null);
  const active = missions[mission] ?? missions[0]!;
  const completedQuests = answers.filter(Boolean).length;

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const scrollToQuest = useCallback((index: number) => {
    const checkpoints = [0.14, 0.47, 0.74];
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: scrollable * (checkpoints[index] ?? 0.14), behavior: "smooth" });
  }, []);

  const answerQuest = useCallback(
    (choice: string) => {
      const questIndex = mission;
      setAnswers((current) => {
        const next = [...current];
        next[questIndex] = choice;
        return next;
      });
      setReward(missions[questIndex]?.reward ?? "회복 근거 획득");
      if (rewardTimerRef.current) window.clearTimeout(rewardTimerRef.current);
      rewardTimerRef.current = window.setTimeout(() => {
        setReward(null);
        setIsQuestOpen(false);
        setCustomInput("");
        if (questIndex < missions.length - 1) scrollToQuest(questIndex + 1);
      }, 850);
    },
    [mission, scrollToQuest],
  );

  const handleCustomSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (!customInput.trim()) return;
      answerQuest(customInput.trim());
    },
    [customInput, answerQuest],
  );

  const openLedger = useCallback((tab: "borrower" | "admin" = "borrower") => {
    setAnswers((current) => [
      current[0] || missions[0].choices[1]!,
      current[1] || missions[1].choices[0]!,
      current[2] || missions[2].choices[0]!,
    ]);
    setLedgerTab(tab);
    setIsLedgerOpen(true);
  }, []);

  const handleArrival = useCallback(() => {
    const missingQuest = answers.findIndex((answer) => !answer);
    if (missingQuest === -1) {
      openLedger("borrower");
      return;
    }
    scrollToQuest(missingQuest);
  }, [answers, scrollToQuest, openLedger]);

  const restartJourney = useCallback(() => {
    setIsLedgerOpen(false);
    setAnswers([null, null, null]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const copySummary = useCallback(() => {
    const summaryText = `[동행금융 새벽 골목길 회복 상담 요약서]
- 차주: 동행카페 지원님
- 01 상황 및 변화 원인: ${answers[0] || missions[0].choices[1]}
- 02 현금흐름 첫 실천 목표: ${answers[1] || missions[1].choices[0]}
- 03 금융 상담 준비 증빙: ${answers[2] || missions[2].choices[0]}
- 월 매출 2,200만 원 / 고정비 1,550만 원 / 월 상환 가능 여력 470만 원
- 준비 증빙: 최근 3개월 카드 매출 정산서, 임대차 계약서, 향후 12개월 상환 계획표`;
    void navigator.clipboard.writeText(summaryText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [answers]);

  useEffect(() => {
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ progress: number; mission: number }>).detail;
      setProgress(detail.progress);
      setMission(detail.mission);
    };
    const enterDemo = () => {
      if (answersRef.current.every(Boolean)) openLedger("borrower");
    };
    window.addEventListener("donghaeng:progress", update);
    window.addEventListener("donghaeng:enter-demo", enterDemo);
    return () => {
      window.removeEventListener("donghaeng:progress", update);
      window.removeEventListener("donghaeng:enter-demo", enterDemo);
    };
  }, [openLedger]);

  useEffect(
    () => () => {
      if (rewardTimerRef.current) window.clearTimeout(rewardTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    if (initialView === "admin") {
      const doScroll = () => {
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        if (scrollable > 0) {
          window.scrollTo({ top: scrollable * 0.95, behavior: "instant" });
        }
      };
      doScroll();
      const raf = requestAnimationFrame(doScroll);
      const timer = setTimeout(doScroll, 120);
      return () => {
        cancelAnimationFrame(raf);
        clearTimeout(timer);
      };
    }
  }, [initialView]);

  return (
    <>
      <main className={`mission-road-home${isQuestOpen ? " is-quest-open" : ""}`}>
        <div className="mission-road-sticky">
          <Suspense fallback={<span className="mission-road-loading">길을 준비하고 있습니다</span>}>
            <AlleyHopeJourney initialProgress={initialView === "admin" ? 0.95 : 0} />
          </Suspense>

          <header className="mission-road-nav">
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              <a href="#start" className="mission-road-brand" aria-label="동행금융 처음으로">
                동행금융
              </a>
              <p>
                {initialView === "admin" || (isLedgerOpen && ledgerTab === "admin")
                  ? "금융기관 심사역 검토 파일 · 회복 근거 확인"
                  : `회복 퀘스트 ${completedQuests} / ${missions.length} · 회복 근거 수집 중`}
              </p>
            </div>
            <nav style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <a
                href="/borrower"
                style={{
                  color: "#f6efe2",
                  fontSize: "12px",
                  fontWeight: 600,
                  textDecoration: "none",
                  padding: "5px 11px",
                  borderRadius: "6px",
                  background: "rgba(255, 248, 235, 0.12)",
                  border: "1px solid rgba(212, 178, 126, 0.35)",
                  backdropFilter: "blur(6px)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                사장님 대화실
              </a>
              <a
                href="/demo/admin"
                style={{
                  color: "#f6efe2",
                  fontSize: "12px",
                  fontWeight: 600,
                  textDecoration: "none",
                  padding: "5px 11px",
                  borderRadius: "6px",
                  background: "rgba(255, 248, 235, 0.12)",
                  border: "1px solid rgba(212, 178, 126, 0.35)",
                  backdropFilter: "blur(6px)",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                }}
              >
                심사역 서류실
              </a>
              <a
                href="/login"
                style={{
                  color: "#d4b27e",
                  fontSize: "12px",
                  fontWeight: 600,
                  textDecoration: "none",
                  padding: "5px 11px",
                  borderRadius: "6px",
                  background: "rgba(23, 58, 50, 0.4)",
                  border: "1px solid rgba(212, 178, 126, 0.25)",
                  backdropFilter: "blur(6px)",
                }}
              >
                상담사 로그인
              </a>
            </nav>
          </header>


          <section
            className="mission-road-intro"
            id="start"
            aria-labelledby="mission-road-title"
            style={{
              opacity: initialView === "admin" ? 0 : Math.max(0, 1 - progress * 6),
              transform: `translateY(${-progress * 32}px)`,
              pointerEvents: initialView === "admin" || progress > 0.05 ? "none" : "auto",
              display: initialView === "admin" ? "none" : undefined,
            }}
          >
            <h1 id="mission-road-title">
              다시 문을 여는 길,
              <br />
              함께 걷습니다.
            </h1>
            <p>
              멈춰 있던 가게가 다시 손님을 맞을 때까지. 따뜻한 동행 대화로 사장님의 상황을 경청하고,
              실행과 기록을 모아 다음 금융 상담을 위한 회복의 근거로 만듭니다.
            </p>
            <div className="mission-road-scroll-cue" aria-hidden="true">
              <i />
              <span>스크롤해 새벽 골목길을 걸어보세요</span>
            </div>
          </section>

          <button
            key={`quest-${mission}`}
            type="button"
            className={`mission-quest-marker quest-position-${mission}${answers[mission] ? " is-complete" : ""}`}
            style={{
              opacity: progress > 0.07 && progress < 0.84 && !isQuestOpen ? 1 : 0,
              pointerEvents: progress > 0.07 && progress < 0.84 && !isQuestOpen ? "auto" : "none",
            }}
            onClick={() => setIsQuestOpen(true)}
            aria-expanded={isQuestOpen}
            aria-controls="mission-quest-dialog"
          >
            <span className="mission-quest-beacon" aria-hidden="true">
              <i />
            </span>
            <span className="mission-quest-copy">
              <small>{answers[mission] ? "퀘스트 완료" : `퀘스트 ${mission + 1}`}</small>
              <strong>{active.quest}</strong>
              <em>{answers[mission] ? "근거 수집됨" : "질문 열기"}</em>
            </span>
          </button>

          <section
            id="mission-quest-dialog"
            className={`mission-quest-dialog${isQuestOpen ? " is-open" : ""}`}
            role="dialog"
            aria-modal="false"
            aria-labelledby="mission-quest-question"
            aria-hidden={!isQuestOpen}
          >
            <header>
              <span className="mission-quest-guide" aria-hidden="true">
                동
              </span>
              <div>
                <small>{`골목길 동행자 · 퀘스트 ${mission + 1}`}</small>
                <strong>{active.quest}</strong>
              </div>
              <button
                type="button"
                className="mission-quest-close"
                onClick={() => setIsQuestOpen(false)}
                aria-label="퀘스트 질문 닫기"
              >
                <i />
              </button>
            </header>
            <div className="mission-quest-body">
              <p id="mission-quest-question">{active.question}</p>
              <div className="mission-quest-choices">
                {active.choices.map((choice, index) => (
                  <button
                    type="button"
                    className={answers[mission] === choice ? "is-selected" : ""}
                    onClick={() => answerQuest(choice)}
                    disabled={Boolean(reward)}
                    key={choice}
                  >
                    <span>{index + 1}</span>
                    {choice}
                  </button>
                ))}
                <form onSubmit={handleCustomSubmit} style={{ marginTop: "12px", display: "flex", gap: "8px" }}>
                  <input
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    placeholder="직접 사장님의 상황을 적어주셔도 좋아요"
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      border: "1px solid #d7c7ae",
                      borderRadius: "6px",
                      fontSize: "12.5px",
                      background: "#fffcf6",
                    }}
                  />
                  <button
                    type="submit"
                    disabled={!customInput.trim() || Boolean(reward)}
                    style={{
                      padding: "8px 14px",
                      background: "var(--companion-green)",
                      color: "#fff",
                      border: 0,
                      borderRadius: "6px",
                      fontSize: "12.5px",
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    남기기
                  </button>
                </form>
              </div>
            </div>
            <footer>
              <span>{`회복 근거 ${completedQuests} / ${missions.length}`}</span>
              <i>
                <b
                  style={
                    {
                      "--quest-progress": completedQuests / missions.length,
                    } as CSSProperties
                  }
                />
              </i>
            </footer>
            <div className={`mission-quest-reward${reward ? " is-visible" : ""}`} aria-live="polite">
              <span>근거 획득</span>
              <strong>{reward}</strong>
            </div>
          </section>

          <section
            key={active.title}
            className="mission-road-hud"
            aria-live="polite"
            style={{
              opacity: progress > 0.07 && progress < 0.82 ? 1 : 0,
              pointerEvents: progress > 0.07 && progress < 0.82 ? "auto" : "none",
            }}
          >
            <div className="mission-road-hud-title">
              <p>{`걸음 ${mission + 1} / ${missions.length}`}</p>
              <h2>{active.title}</h2>
            </div>
            <div className="mission-road-connector" aria-hidden="true">
              <i />
            </div>
            <dl className="mission-road-detail">
              <div>
                <dt>동행이 귀 기울이는 것</dt>
                <dd>{active.heard}</dd>
              </div>
              <div>
                <dt>이번에 남기는 것</dt>
                <dd>{active.outcome}</dd>
              </div>
            </dl>
          </section>

          <nav
            className="mission-road-progress mission-road-progress-accessible"
            aria-label="동행 대화 후 만들어질 회복 미션 미리보기"
          >
            <div className="mission-progress-track" aria-hidden="true">
              <i style={{ "--route-progress": progress } as CSSProperties} />
            </div>
            <ol>
              {missions.map((item, index) => (
                <li
                  className={index === mission ? "is-current" : index < mission ? "is-viewed" : ""}
                  key={item.title}
                >
                  <span aria-hidden="true" />
                  <b>{item.title}</b>
                </li>
              ))}
            </ol>
          </nav>

          <section
            className={`mission-road-arrival${progress > 0.86 ? " is-visible" : ""}`}
            aria-hidden={progress <= 0.86}
          >
            <p>가게의 불이 다시 켜졌습니다.</p>
            <h2>
              빛을 따라
              <br />
              새로운 시작으로.
            </h2>
            <div className="mission-road-arrival-actions">
              <button
                type="button"
                className="arrival-primary-btn"
                onClick={handleArrival}
                disabled={progress <= 0.88}
              >
                {completedQuests === missions.length
                  ? "동행 회복 장부 열기"
                  : `남은 퀘스트 ${missions.length - completedQuests}개 확인하기`}
                <span aria-hidden="true">→</span>
              </button>
              <div style={{ marginTop: "14px", display: "flex", gap: "16px", justifyContent: "center" }}>
                <button
                  type="button"
                  onClick={() => openLedger("admin")}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    fontSize: "12px",
                    color: "var(--route-gold-text, #a8793b)",
                    textDecoration: "underline",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  금융기관 심사역 검토 서류 바로보기
                </button>
              </div>
            </div>
            <small>
              {completedQuests === missions.length
                ? "세 가지 회복 근거를 모두 모았습니다. 3D 골목길 위에서 사장님의 회복 장부와 심사역 서류를 펼쳐봅니다."
                : "골목의 질문에 답해 세 가지 회복 근거를 모아주세요. 대출 승인을 단정하지 않고 금융기관 상담 준비를 돕습니다."}
            </small>
          </section>

          {/* 3D 골목길 공간 내 일체형 회복 장부 & 심사역 서류 오버레이 보드 */}
          <div
            className={`alley-spatial-ledger${isLedgerOpen ? " is-open" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="spatial-ledger-title"
          >
            <div className="spatial-ledger-card">
              <header className="spatial-ledger-header">
                <div>
                  <span className="spatial-ledger-badge">
                    <CheckCircle2 size={15} /> 동행의 세 걸음 완성
                  </span>
                  <h2 id="spatial-ledger-title">동행카페 지원님, 길 위에서 엮어낸 회복 장부입니다.</h2>
                </div>
                <div className="spatial-ledger-tabs">
                  <button
                    type="button"
                    className={ledgerTab === "borrower" ? "is-active" : ""}
                    onClick={() => setLedgerTab("borrower")}
                  >
                    사장님의 길 (내 3대 회복 미션)
                  </button>
                  <button
                    type="button"
                    className={ledgerTab === "admin" ? "is-active" : ""}
                    onClick={() => setLedgerTab("admin")}
                  >
                    금융기관의 길 (심사역 검토 파일)
                  </button>
                </div>
                <button
                  type="button"
                  className="spatial-ledger-close"
                  onClick={() => setIsLedgerOpen(false)}
                  aria-label="장부 닫기"
                >
                  <i />
                </button>
              </header>

              {ledgerTab === "borrower" ? (
                /* 사장님 뷰: 3대 회복 미션 장부 */
                <div>
                  <div className="spatial-ledger-grid">
                    <div className="spatial-ledger-pillar">
                      <small>걸음 01 · 변화 원인 요약</small>
                      <h3>상황을 말로 풀어내기</h3>
                      <div className="spatial-ledger-quote">
                        <p>“{answers[0] || "가게 리뉴얼과 새 메뉴 개발로 다시 매출이 오르고 있어요."}”</p>
                      </div>
                      <p className="spatial-ledger-desc">
                        실천 과제: 리뉴얼 후 단골 고객 복귀를 입증할 수 있도록 최근 3개월의 매출 상승 추세를 기록합니다.
                      </p>
                    </div>

                    <div className="spatial-ledger-pillar">
                      <small>걸음 02 · 첫 행동 목표</small>
                      <h3>현금흐름 습관 만들기</h3>
                      <div className="spatial-ledger-quote">
                        <p>“{answers[1] || "불필요한 구독과 통신비, 공과금부터 줄여볼 수 있어요."}”</p>
                      </div>
                      <p className="spatial-ledger-desc">
                        실천 과제: 원재료비 및 불필요한 고정 지출을 정비하여 월 70만 원의 실질 잉여 자금을 상환 재원으로 확보합니다.
                      </p>
                    </div>

                    <div className="spatial-ledger-pillar">
                      <small>걸음 03 · 상담 준비 근거</small>
                      <h3>상담 자료 준비하기</h3>
                      <div className="spatial-ledger-quote">
                        <p>“{answers[2] || "최근 3개월 카드 매출 정산 내역과 입출금 통장을 준비할게요."}”</p>
                      </div>
                      <p className="spatial-ledger-desc">
                        실천 과제: 카드사 정산 내역과 임대차 계약서를 구비하여 금융기관 대출 심사 시 실질 상환 능력을 소명합니다.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                /* 금융기관 심사역 뷰: CASE 001 검토 서류 파일 */
                <div>
                  <div className="spatial-dossier-hero">
                    <div>
                      <small style={{ color: "#f2c46f", fontWeight: 700, fontSize: "11px", letterSpacing: "0.08em" }}>
                        심사역 검토 요약 · 가상 사례 (CASE 001)
                      </small>
                      <h3>동행카페 지원님 회복 근거 파일</h3>
                      <p>
                        단순 신용점수만으로는 알 수 없었던 사업 재개 맥락과 구체적 지출 조정 의지가 사장님의 구술 대화를 통해 3대 회복 근거로 정리되었습니다.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={copySummary}
                      className="spatial-btn-secondary"
                      style={{ flexShrink: 0 }}
                    >
                      <Copy size={15} /> {copied ? "복사 완료!" : "상담 요약서 복사"}
                    </button>
                  </div>

                  <div className="spatial-ledger-grid">
                    <div className="spatial-ledger-pillar">
                      <small>근거 01 · 상황과 변화 원인</small>
                      <h3>사업 공백과 매출 회복</h3>
                      <div className="spatial-ledger-quote">
                        <p>“{answers[0] || "가게 리뉴얼과 새 메뉴 개발로 다시 매출이 오르고 있어요."}”</p>
                      </div>
                      <p className="spatial-ledger-desc" style={{ color: "#493f34" }}>
                        심사 검토 의견: 단순 영업 부진이 아닌 매장 시설 리뉴얼을 위한 일시 휴업이었으며, 재오픈 이후 단골 고객 유입으로 정상 영업 궤도에 진입한 상태임.
                      </p>
                    </div>

                    <div className="spatial-ledger-pillar">
                      <small>근거 02 · 현금흐름 습관</small>
                      <h3>월 자금 흐름과 첫 목표</h3>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", margin: "10px 0", background: "#f8f5ee", padding: "10px", borderRadius: "8px" }}>
                        <div>
                          <span style={{ fontSize: "10px", color: "#8a7e6f", display: "block" }}>월평균 매출</span>
                          <strong style={{ fontSize: "14px", color: "var(--forest-ink)" }}>2,200만 원</strong>
                        </div>
                        <div>
                          <span style={{ fontSize: "10px", color: "#8a7e6f", display: "block" }}>재료비+고정비</span>
                          <strong style={{ fontSize: "14px", color: "var(--forest-ink)" }}>1,550만 원</strong>
                        </div>
                        <div>
                          <span style={{ fontSize: "10px", color: "#8a7e6f", display: "block" }}>월 상환 가능액</span>
                          <strong style={{ fontSize: "14px", color: "var(--companion-green)" }}>470만 원</strong>
                        </div>
                        <div>
                          <span style={{ fontSize: "10px", color: "#8a7e6f", display: "block" }}>조정 지출</span>
                          <strong style={{ fontSize: "14px", color: "#a8793b" }}>원재료·소모품</strong>
                        </div>
                      </div>
                      <p className="spatial-ledger-desc" style={{ color: "#493f34" }}>
                        상환 여력 판단: 고정비 차감 후 월 470만 원의 실질 잔여 자금이 발생하며, 지출 절감 의지가 확인되어 상환 안정성이 양호함.
                      </p>
                    </div>

                    <div className="spatial-ledger-pillar">
                      <small>근거 03 · 금융 상담 준비 증빙</small>
                      <h3>제출 준비 자료 패키지</h3>
                      <ul style={{ listStyle: "none", padding: 0, margin: "10px 0", fontSize: "12px", color: "#493f34", display: "grid", gap: "6px" }}>
                        <li style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <Check size={14} color="#285c4d" /> 최근 3개월 카드 매출 정산서 (구비 완료)
                        </li>
                        <li style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <Check size={14} color="#285c4d" /> 임대차 계약서 및 리뉴얼 공사 영수증
                        </li>
                        <li style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          <Check size={14} color="#285c4d" /> 향후 12개월 상환 계획표 작성 완료
                        </li>
                      </ul>
                      <p className="spatial-ledger-desc" style={{ color: "#493f34" }}>
                        상담 자료 상태: 금융기관 심사역이 현장 심사 없이도 즉각 차주의 회복 가능성을 검토할 수 있도록 필수 증빙이 사전에 완비됨.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              <footer className="spatial-ledger-footer">
                <button
                  type="button"
                  className="spatial-btn-secondary"
                  onClick={restartJourney}
                >
                  <RotateCcw size={15} /> 골목길 처음부터 다시 걷기
                </button>
                <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                  <a
                    href="/demo/admin"
                    className="spatial-btn-secondary"
                    style={{ textDecoration: "none", color: "inherit", display: "inline-flex", alignItems: "center", gap: "4px" }}
                  >
                    심사역 서류실 전체 화면 →
                  </a>
                  <button
                    type="button"
                    className="spatial-btn-secondary"
                    onClick={copySummary}
                  >
                    <Copy size={15} /> {copied ? "복사 완료!" : "상담 요약서 복사"}
                  </button>
                  <button
                    type="button"
                    className="spatial-btn-primary"
                    onClick={() => setIsLedgerOpen(false)}
                  >
                    길 위의 풍경 계속 보기
                  </button>
                </div>

              </footer>
            </div>
          </div>
        </div>
        <div className="mission-road-scroll-space" aria-hidden="true" />
      </main>
    </>
  );
}
