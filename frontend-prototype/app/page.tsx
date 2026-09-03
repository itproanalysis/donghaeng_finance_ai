"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ServiceLinks } from "./components/ServiceNavigation";
import { recordQuest, useCases } from "./lib/case-store";

const AlleyHopeJourney = lazy(() => import("./components/AlleyHopeJourney"));
const emptyQuests = [null, null, null];

const missions = [
  {
    title: "상황을 말로 풀어내기",
    heard: "매출 변화 · 사업 공백의 이유",
    outcome: "상황과 변화 원인을 한 문장으로",
    quest: "사업 공백의 이유",
    question: "최근 매출이 줄어든 가장 큰 이유는 무엇인가요?",
    choices: ["계절·상권 변화", "휴업·공사", "원가·고정비 상승"],
    reward: "변화 원인 요약",
  },
  {
    title: "현금흐름 습관 만들기",
    heard: "현재 매출 · 고정비 · 카드 지출",
    outcome: "오늘 실행할 수 있는 지출 목표",
    quest: "조정 가능한 지출",
    question: "지금 가장 먼저 조정해볼 수 있는 지출은 무엇인가요?",
    choices: ["카드·소모품비", "원재료비", "임대료·인건비"],
    reward: "첫 행동 목표",
  },
  {
    title: "상담 자료 준비하기",
    heard: "실행 기록 · 준비 가능한 증빙",
    outcome: "금융기관이 다시 검토할 자료",
    quest: "준비 가능한 증빙",
    question: "다음 금융 상담 전에 준비할 수 있는 자료는 무엇인가요?",
    choices: ["매출 회복 자료", "신규 계약·예약", "상환 계획표"],
    reward: "상담 준비 근거",
  },
];

export default function Home() {
  const router = useRouter();
  const [mission, setMission] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isLeaving, setIsLeaving] = useState(false);
  const [isQuestOpen, setIsQuestOpen] = useState(false);
  const {current} = useCases();
  const answers = current && !current.completedAt ? current.quests : emptyQuests;
  const [openedQuest, setOpenedQuest] = useState(0);
  const [saveError, setSaveError] = useState("");
  const [reward, setReward] = useState<string | null>(null);
  const leavingRef = useRef(false);
  const answersRef = useRef(answers);
  const rewardTimerRef = useRef<number | null>(null);
  const active = missions[isQuestOpen ? openedQuest : mission];
  const completedQuests = answers.filter(Boolean).length;

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const startInterview = useCallback(() => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    setIsLeaving(true);
    window.setTimeout(() => router.push("/demo"), 1480);
  }, [router]);

  const scrollToQuest = useCallback((index: number) => {
    const checkpoints = [0.14, 0.47, 0.74];
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    window.scrollTo({ top: scrollable * checkpoints[index], behavior: "smooth" });
  }, []);

  const answerQuest = useCallback((choice: string) => {
    const questIndex = openedQuest;
    try { recordQuest(questIndex, choice); setSaveError(""); }
    catch (error) { setSaveError(error instanceof Error ? error.message : "답변을 저장하지 못했어요."); return; }
    setReward(missions[questIndex].reward);
    if (rewardTimerRef.current) window.clearTimeout(rewardTimerRef.current);
    rewardTimerRef.current = window.setTimeout(() => {
      setReward(null);
      setIsQuestOpen(false);
      if (questIndex < missions.length - 1) scrollToQuest(questIndex + 1);
    }, 850);
  }, [openedQuest, scrollToQuest]);

  const handleArrival = useCallback(() => {
    const missingQuest = answers.findIndex((answer) => !answer);
    if (missingQuest === -1) {
      startInterview();
      return;
    }
    scrollToQuest(missingQuest);
  }, [answers, scrollToQuest, startInterview]);

  useEffect(() => {
    router.prefetch("/demo");
    const update = (event: Event) => {
      const detail = (event as CustomEvent<{ progress: number; mission: number }>).detail;
      setProgress(detail.progress);
      setMission(detail.mission);
    };
    const enterDemo = () => {
      if (answersRef.current.every(Boolean)) startInterview();
    };
    window.addEventListener("donghaeng:progress", update);
    window.addEventListener("donghaeng:enter-demo", enterDemo);
    return () => {
      window.removeEventListener("donghaeng:progress", update);
      window.removeEventListener("donghaeng:enter-demo", enterDemo);
    };
  }, [router, startInterview]);

  useEffect(() => () => {
    if (rewardTimerRef.current) window.clearTimeout(rewardTimerRef.current);
  }, []);

  return (
    <main className={`mission-road-home${isLeaving ? " is-leaving" : ""}${isQuestOpen ? " is-quest-open" : ""}`}>
      <div className="mission-road-sticky">
        <Suspense fallback={<span className="mission-road-loading">길을 준비하고 있습니다</span>}>
          <AlleyHopeJourney />
        </Suspense>

        <header className="mission-road-nav">
          <a href="#start" className="mission-road-brand" aria-label="동행금융 처음으로">동행금융</a>
          <p>{`퀘스트 ${completedQuests} / ${missions.length} · 회복 근거 수집 중`}</p>
          <ServiceLinks compact />
        </header>

        <section
          className="mission-road-intro"
          id="start"
          aria-labelledby="mission-road-title"
          style={{ opacity: Math.max(0, 1 - progress * 6), transform: `translateY(${-progress * 32}px)` }}
        >
          <h1 id="mission-road-title">다시 문을 여는 길,<br />함께 걷습니다.</h1>
          <p>멈춰 있던 가게가 다시 손님을 맞을 때까지. AI 인터뷰로 상황을 듣고, 실행과 기록을 회복의 근거로 만듭니다.</p>
          <div className="mission-road-scroll-cue" aria-hidden="true">
            <i />
            <span>스크롤해 함께 걸어보세요</span>
          </div>
        </section>

        <button
          key={`quest-${mission}`}
          type="button"
          className={`mission-quest-marker quest-position-${mission}${answers[mission] ? " is-complete" : ""}`}
          style={{ opacity: progress > 0.07 && progress < 0.84 && !isQuestOpen ? 1 : 0, pointerEvents: progress > 0.07 && progress < 0.84 && !isQuestOpen ? "auto" : "none" }}
          onClick={() => { setOpenedQuest(mission); setIsQuestOpen(true); }}
          aria-expanded={isQuestOpen}
          aria-controls="mission-quest-dialog"
        >
          <span className="mission-quest-beacon" aria-hidden="true"><i /></span>
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
          inert={!isQuestOpen}
        >
          <header>
            <span className="mission-quest-guide" aria-hidden="true">동</span>
            <div>
              <small>{`AI 동행자 · 퀘스트 ${openedQuest + 1}`}</small>
              <strong>{active.quest}</strong>
            </div>
            <button type="button" className="mission-quest-close" onClick={() => setIsQuestOpen(false)} aria-label="퀘스트 질문 닫기"><i /></button>
          </header>
          <div className="mission-quest-body">
            <p id="mission-quest-question">{active.question}</p>
            <div className="mission-quest-choices">
              {active.choices.map((choice, index) => (
                <button
                  type="button"
                  className={answers[openedQuest] === choice ? "is-selected" : ""}
                  onClick={() => answerQuest(choice)}
                  disabled={Boolean(reward)}
                  key={choice}
                >
                  <span>{index + 1}</span>
                  {choice}
                </button>
              ))}
            </div>
          </div>
          {saveError && <p className="companion-error" role="alert">{saveError}</p>}
          <footer>
            <span>{`회복 근거 ${completedQuests} / ${missions.length}`}</span>
            <i><b style={{ "--quest-progress": completedQuests / missions.length } as CSSProperties} /></i>
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
          style={{ opacity: progress > 0.07 && progress < 0.82 ? 1 : 0, pointerEvents: progress > 0.07 && progress < 0.82 ? "auto" : "none" }}
        >
          <div className="mission-road-hud-title">
            <p>{`걸음 ${mission + 1} / ${missions.length}`}</p>
            <h2>{active.title}</h2>
          </div>
          <div className="mission-road-connector" aria-hidden="true"><i /></div>
          <dl className="mission-road-detail">
            <div>
              <dt>AI가 듣는 것</dt>
              <dd>{active.heard}</dd>
            </div>
            <div>
              <dt>이번에 남기는 것</dt>
              <dd>{active.outcome}</dd>
            </div>
          </dl>
        </section>

        <nav className="mission-road-progress mission-road-progress-accessible" aria-label="AI 인터뷰 후 만들어질 회복 미션 미리보기">
          <div className="mission-progress-track" aria-hidden="true"><i style={{ "--route-progress": progress } as CSSProperties} /></div>
          <ol>
            {missions.map((item, index) => (
              <li className={index === mission ? "is-current" : index < mission ? "is-viewed" : ""} key={item.title}>
                <span aria-hidden="true" />
                <b>{item.title}</b>
              </li>
            ))}
          </ol>
        </nav>

        <section className={`mission-road-arrival${progress > 0.86 ? " is-visible" : ""}`} aria-hidden={progress <= 0.86}>
          <p>가게의 불이 다시 켜졌습니다.</p>
          <h2>빛을 따라<br />새로운 시작으로.</h2>
          <button type="button" onClick={handleArrival} disabled={isLeaving || progress <= 0.88}>
            {isLeaving ? "카페 안으로 들어가는 중" : completedQuests === missions.length ? "본 인터뷰 시작하기" : `남은 퀘스트 ${missions.length - completedQuests}개`}
            <span aria-hidden="true">→</span>
          </button>
          <small>{completedQuests === missions.length ? "세 가지 회복 근거를 모두 모았습니다. 카페 안에서 더 자세한 AI 인터뷰를 이어갑니다." : "골목의 질문에 답해 세 가지 회복 근거를 모아주세요. 대출 승인이 아닌 다음 금융 상담의 준비를 돕습니다."}</small>
        </section>

        <div className="mission-road-transition" aria-hidden="true"><i /><span /></div>
      </div>
      <div className="mission-road-scroll-space" aria-hidden="true" />
    </main>
  );
}
