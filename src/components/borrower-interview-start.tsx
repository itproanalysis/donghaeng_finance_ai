"use client";

import { ChevronRight, Headphones, LoaderCircle, MessageCircle, Mic, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ApiRequestError, authenticatedFetch, extractInterviewId, readApiEnvelope } from "@/components/api-adapter";
import {
  createBorrowerRequiredInformationList,
  BORROWER_CONVERSATION_FOCUS_OPTIONS,
  type BorrowerConversationFocus,
} from "@/components/borrower-interview-preferences";
import { unlockQuestionVoicePlayback } from "@/components/question-voice-playback";
import { BORROWER_JOURNEY, JourneyNav } from "@/components/journey-nav";
import { OPERATING_DAY_DEMO_SCENARIO } from "@/domain/demo-scenario";

type InterviewMethod = "chat" | "voice";
type BorrowerIndustry = "RESTAURANT" | "CAFE" | "OFFLINE_RETAIL" | "ONLINE_SHOPPING" | "BEAUTY" | "ACADEMY" | "LODGING" | "AUTO_REPAIR" | "INTERIOR" | "TRANSPORT" | "WHOLESALE_SMALL_MANUFACTURING";

const INDUSTRY_OPTIONS: readonly { code: BorrowerIndustry; label: string }[] = [
  { code: "RESTAURANT", label: "음식점" },
  { code: "CAFE", label: "카페·음료점" },
  { code: "OFFLINE_RETAIL", label: "오프라인 소매점" },
  { code: "ONLINE_SHOPPING", label: "온라인 쇼핑몰" },
  { code: "BEAUTY", label: "미용·뷰티" },
  { code: "ACADEMY", label: "학원·교육" },
  { code: "LODGING", label: "숙박" },
  { code: "AUTO_REPAIR", label: "자동차 정비" },
  { code: "INTERIOR", label: "인테리어·시공" },
  { code: "TRANSPORT", label: "운송" },
  { code: "WHOLESALE_SMALL_MANUFACTURING", label: "도소매·소규모 제조" },
];

const CLOUD_AI_CONSENT_VERSION = "cloud-ai-processing-v1";
const MICROPHONE_CONSENT_VERSION = "microphone-interview-v1";

export function BorrowerInterviewStart({ publicReview = false, sampleEntry = false, scenarioEntry = false, demoSet = "primary" }: { publicReview?: boolean; sampleEntry?: boolean; scenarioEntry?: boolean; demoSet?: "primary" | "control" }) {
  const router = useRouter();
  const scenario = scenarioEntry ? OPERATING_DAY_DEMO_SCENARIO : null;
  const [showProfile, setShowProfile] = useState(publicReview);
  const [showMethods, setShowMethods] = useState(sampleEntry || scenarioEntry);
  const [showGuide, setShowGuide] = useState(false);
  const [borrowerName, setBorrowerName] = useState(scenario?.persona.borrowerName ?? (sampleEntry ? "체험 사장님" : ""));
  const [businessName, setBusinessName] = useState(scenario?.persona.businessName ?? (sampleEntry ? "체험용 가상 카페" : ""));
  const [industryCode, setIndustryCode] = useState<BorrowerIndustry | "">(scenario ? "RESTAURANT" : sampleEntry ? "CAFE" : "");
  const [usingSample, setUsingSample] = useState(sampleEntry);
  const [conversationFocus, setConversationFocus] = useState<BorrowerConversationFocus>("FULL_REVIEW");
  const [cloudConsent, setCloudConsent] = useState(false);
  const [starting, setStarting] = useState<InterviewMethod | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [validateFields, setValidateFields] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const businessRef = useRef<HTMLInputElement>(null);
  const industryRef = useRef<HTMLSelectElement>(null);
  const consentRef = useRef<HTMLInputElement>(null);
  const startButtonRef = useRef<HTMLButtonElement>(null);
  const profileHeadingRef = useRef<HTMLHeadingElement>(null);
  const methodHeadingRef = useRef<HTMLHeadingElement>(null);
  const previousStageRef = useRef("welcome");
  const createdInterviewRef = useRef<string | null>(null);
  const createdProfileRef = useRef<string | null>(null);
  const startingRef = useRef(false);
  const stage = showMethods ? "method" : showProfile ? "profile" : "welcome";
  useEffect(() => {
    if (previousStageRef.current === stage) return;
    previousStageRef.current = stage;
    const target = stage === "method" ? methodHeadingRef.current : stage === "profile" ? profileHeadingRef.current : startButtonRef.current;
    target?.focus();
  }, [stage]);
  const selectedFocus = BORROWER_CONVERSATION_FOCUS_OPTIONS.find(
    (option) => option.id === conversationFocus,
  ) ?? BORROWER_CONVERSATION_FOCUS_OPTIONS[0]!;

  function continueToMethods() {
    setValidateFields(true);
    const missing = !borrowerName.trim() ? nameRef.current : !businessName.trim() ? businessRef.current : !industryCode ? industryRef.current : null;
    if (missing) { missing.focus(); return; }
    if (borrowerName !== "체험 사장님" || businessName !== "체험용 가상 카페" || industryCode !== "CAFE") setUsingSample(false);
    setError(null);
    setShowMethods(true);
  }

  function startSample() {
    setBorrowerName("체험 사장님");
    setBusinessName("체험용 가상 카페");
    setIndustryCode("CAFE");
    setUsingSample(true);
    setError(null);
    setShowMethods(true);
  }

  async function recordConsent(interviewId: string, purpose: string, version: string) {
    const response = await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/consents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, consentVersion: version, granted: true, expiresAt: null }),
    });
    await readApiEnvelope(response);
  }

  async function begin(method: InterviewMethod) {
    if (startingRef.current) return;
    if (!cloudConsent) {
      setError("AI 처리 안내를 확인하고 동의해 주세요.");
      consentRef.current?.focus();
      return;
    }

    if (!borrowerName.trim() || !businessName.trim() || !industryCode) {
      setError("인터뷰 전에 사장님 성함, 사업체 이름과 업종을 알려주세요.");
      return;
    }
    // Browser audio permissions are transient. Unlock before the network calls
    // and preserve the context through client-side navigation so the first AI
    // greeting can actually play on arrival.
    if (method === "voice") unlockQuestionVoicePlayback();
    startingRef.current = true;
    setStarting(method);
    setError(null);
    try {
      const requiredInformationList = createBorrowerRequiredInformationList(industryCode, conversationFocus, scenario?.id);
      const profileKey = JSON.stringify([borrowerName.trim(), businessName.trim(), industryCode, conversationFocus]);
      let interviewId = createdProfileRef.current === profileKey ? createdInterviewRef.current : null;
      if (!interviewId) {
        const created = await authenticatedFetch("/api/interviews", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            industryCode,
            profile: {
              borrowerName: borrowerName.trim(),
              businessName: businessName.trim(),
            },
            requiredInformationList,
          }),
        });
        const data = await readApiEnvelope(created);
        interviewId = extractInterviewId(data);
        if (!interviewId) throw new Error("새 인터뷰 식별자를 확인하지 못했습니다.");
        createdInterviewRef.current = interviewId;
        createdProfileRef.current = profileKey;
      }

      await recordConsent(interviewId, "CLOUD_AI_PROCESSING", CLOUD_AI_CONSENT_VERSION);
      if (method === "voice") {
        await recordConsent(interviewId, "MICROPHONE_INTERVIEW", MICROPHONE_CONSENT_VERSION);
      }
      router.push(
        `/borrower/interviews/${encodeURIComponent(interviewId)}?mode=${method}${
          scenario ? `&demo=${scenario.id}&demoSet=${demoSet}` : method === "voice" ? "&autoplay=1" : ""
        }`,
      );
    } catch (caught) {
      if (!publicReview && caught instanceof ApiRequestError && ["AUTHENTICATION_REQUIRED", "SESSION_EXPIRED"].includes(caught.code ?? "")) {
        router.push("/login?next=%2Fborrower");
        return;
      }
      setError(caught instanceof Error ? caught.message : "인터뷰를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setStarting(null);
    } finally {
      startingRef.current = false;
    }
  }

  return (
    <main id="main-content" className="borrower-start" data-stage={stage}>
      <JourneyNav steps={BORROWER_JOURNEY} current={0} label="사장님 인터뷰 전체 흐름" />
      <aside className="borrower-start__place" aria-hidden="true"><span>동행금융</span><p>골목<br />상담소</p></aside>
      <section className="borrower-start__hero" aria-labelledby={stage === "profile" ? "borrower-profile-title" : stage === "method" ? "borrower-method-title" : "borrower-start-title"} aria-busy={starting !== null}>
        <span className="borrower-start__eyebrow">{stage === "welcome" ? "사장님 인터뷰" : stage === "profile" ? "시작 준비 · 1 / 2" : "시작 준비 · 2 / 2"}</span>
        {stage === "welcome" ? <><h1 id="borrower-start-title">가게 현황 입력</h1><p>AI가 묻고 사장님이 답하는 인터뷰입니다.<br />잘 모르거나 답하기 어려운 내용은 넘어가셔도 됩니다.</p></> : stage === "profile" ? <h1 ref={profileHeadingRef} tabIndex={-1} id="borrower-profile-title">기본 정보</h1> : <h1 ref={methodHeadingRef} tabIndex={-1} id="borrower-method-title">답변 방식 선택</h1>}
        {!showProfile ? (
          <div className="borrower-start__actions">
            <button ref={startButtonRef} type="button" className="borrower-primary-button" onClick={() => { setShowGuide(false); setError(null); setShowProfile(true); }}>
              인터뷰 시작 <ChevronRight size={20} />
            </button>
            <button type="button" className="borrower-text-button" aria-expanded={showGuide} aria-controls="borrower-guide" onClick={() => setShowGuide((value) => !value)}>
              인터뷰 방식 알아보기
            </button>
          </div>
        ) : !showMethods ? (
          <form className="borrower-profile" aria-labelledby="borrower-profile-title" noValidate onSubmit={(event) => { event.preventDefault(); continueToMethods(); }}>
            {publicReview && <div className="borrower-quick-start"><strong>가게가 없어도 체험할 수 있어요</strong><p>가상의 호칭·카페 업종으로 시작합니다. 매출이나 답변은 직접 입력해 주세요.</p><button type="button" className="borrower-primary-button" onClick={startSample}>체험용 카페로 바로 시작 <ChevronRight size={20} /></button><Link href="/modeling?case=case_operating_drop">입력 없이 분석 사례 먼저 보기</Link></div>}
            <p className="borrower-profile__intro">{publicReview ? "내 가게로 시작하려면 아래 세 가지만 알려주세요. 실명 대신 별칭을 써도 됩니다." : "아래 세 가지만 알려주세요. 업종에 맞춰 이야기 나눌게요."}</p>
            <div className="borrower-profile__fields">
              <label>성함 또는 편한 호칭<input ref={nameRef} required aria-invalid={validateFields && !borrowerName.trim()} aria-describedby={validateFields && !borrowerName.trim() ? "borrower-name-error" : undefined} value={borrowerName} maxLength={80} onChange={(event) => setBorrowerName(event.target.value)} placeholder="예: 김동행" autoComplete="name" />{validateFields && !borrowerName.trim() && <span className="borrower-field-error" id="borrower-name-error">어떻게 불러드리면 될까요?</span>}</label>
              <label>사업체 이름<input ref={businessRef} required aria-invalid={validateFields && !businessName.trim()} aria-describedby={validateFields && !businessName.trim() ? "borrower-business-error" : undefined} value={businessName} maxLength={80} onChange={(event) => setBusinessName(event.target.value)} placeholder="예: 동행상점" autoComplete="organization" />{validateFields && !businessName.trim() && <span className="borrower-field-error" id="borrower-business-error">사업체 이름을 입력해 주세요.</span>}</label>
              <label>업종<select ref={industryRef} required aria-invalid={validateFields && !industryCode} aria-describedby={validateFields && !industryCode ? "borrower-industry-error" : undefined} value={industryCode} onChange={(event) => setIndustryCode(event.target.value as BorrowerIndustry | "")}><option value="">업종을 선택해 주세요</option>{INDUSTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select>{validateFields && !industryCode && <span className="borrower-field-error" id="borrower-industry-error">실제 운영하시는 업종을 골라 주세요.</span>}</label>
            </div>
            <fieldset className="borrower-profile__focus">
              <legend>어떤 이야기부터 할까요?</legend>
              <select aria-label="먼저 이야기할 주제" aria-describedby="borrower-focus-description" value={conversationFocus} onChange={(event) => setConversationFocus(event.target.value as BorrowerConversationFocus)}>{BORROWER_CONVERSATION_FOCUS_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}{option.recommended ? " (추천)" : ""}</option>)}</select>
              <p id="borrower-focus-description">{selectedFocus.description}</p>
            </fieldset>
            <div className="borrower-profile__actions"><button type="button" className="borrower-text-button" onClick={() => { setError(null); setValidateFields(false); setShowProfile(false); }}>이전</button><button type="submit" className="borrower-primary-button">다음 · 답변 방식 <ChevronRight size={20} /></button></div>
          </form>
        ) : (
          <section className="borrower-methods" aria-labelledby="borrower-method-title">
            <div className="borrower-methods__heading"><p>{businessName} · {INDUSTRY_OPTIONS.find((option) => option.code === industryCode)?.label} · {selectedFocus.label}</p></div>
            {usingSample && <p className="borrower-sample-note">체험용 가상 가게입니다. 이름·업종만 준비했으며, 사업 수치와 인터뷰 답변은 채우지 않았습니다.</p>}
            {scenario && <div className="demo-scenario-notice"><strong>답변에서 평가까지 · 합성 시연</strong><p>{demoSet === "control" ? "사유·목표를 답하지 않은 대조 사례" : "영업일 사유와 목표를 확인한 사례"}입니다. 등록된 대본을 선택해 입력하고, 같은 합성 거래자료에 결합한 2축 점수를 확인합니다.</p><Link href={`/borrower?scenario=operating-day&demoSet=${demoSet === "control" ? "primary" : "control"}`}>{demoSet === "control" ? "사유·목표 확인 사례로 변경" : "사유·목표 미확인 사례로 변경"}</Link></div>}
            {publicReview && !usingSample && <p className="borrower-sample-note">가입 없이 이용하며, 마이크가 없어도 채팅으로 진행할 수 있습니다.</p>}
            <label className="borrower-consent">
              <input ref={consentRef} type="checkbox" checked={cloudConsent} disabled={starting !== null} onChange={(event) => { setCloudConsent(event.target.checked); setError(null); }} />
              <span>제 답변을 질문 정리와 다음 질문 준비를 위해 외부 AI로 처리하는 것에 동의합니다.<small>채팅은 Claude, 음성은 OpenAI Realtime을 우선 사용합니다. 답변은 인터뷰 기록에 저장되며 대출 승인·거절이나 신용등급을 자동으로 판단하지 않습니다.</small></span>
            </label>
            <div className="borrower-methods__grid">
              <button type="button" className="borrower-method-card" onClick={() => void begin("chat")} disabled={starting !== null}>
                <span className="borrower-method-card__icon"><MessageCircle size={25} /></span><strong>채팅으로 답변</strong><small>글자로 입력합니다</small>{starting === "chat" ? <LoaderCircle className="spin" size={18} /> : <ChevronRight size={18} />}
              </button>
              {!scenario && <button type="button" className="borrower-method-card borrower-method-card--voice" onClick={() => void begin("voice")} disabled={starting !== null}>
                <span className="borrower-method-card__icon"><Mic size={25} /></span><strong>음성으로 답변</strong><small>질문을 듣고 말로 답합니다</small>{starting === "voice" ? <LoaderCircle className="spin" size={18} /> : <ChevronRight size={18} />}
              </button>}
            </div>
            {!scenario && <p className="borrower-methods__voice-note"><Headphones size={15} /> 음성 인터뷰에는 마이크가 필요합니다. 도중에 채팅으로 바꿀 수 있습니다.</p>}
            {starting && <p role="status">인터뷰 준비 중…</p>}
            {scenario ? <Link className="borrower-text-button" href="/borrower">내 사업 현황 직접 입력하기</Link> : <button type="button" className="borrower-text-button" disabled={starting !== null} onClick={() => { setError(null); setShowMethods(false); }}>기본 정보 다시 수정하기</button>}
          </section>
        )}
        {error && <p className="borrower-start__error" role="alert">{error}</p>}
        {error && publicReview && <Link className="borrower-text-button" href="/modeling?case=case_operating_drop">입력 없이 분석 사례 계속 보기 <ChevronRight size={16} /></Link>}
      </section>
      <aside className="borrower-start__assurance" aria-label="인터뷰 안내"><ShieldCheck size={19} /><p>답변은 기록에 저장되며 완료 전에 고칠 수 있습니다. 음성 원본은 저장하지 않습니다.</p></aside>
      {showGuide && <section id="borrower-guide" className="borrower-guide" aria-label="인터뷰 방식 안내"><article><span>01</span><h2>가게 소개</h2><p>성함과 사업체 이름, 업종을 알려주세요.</p></article><article><span>02</span><h2>질문과 답변</h2><p>AI가 한 번에 하나씩 묻습니다. 모르는 내용이나 답하기 싫은 내용은 넘어갈 수 있습니다.</p></article><article><span>03</span><h2>기록 확인</h2><p>저장된 답변을 확인하고, 잘못 옮겨진 부분을 수정한 뒤 인터뷰를 마칩니다.</p></article></section>}

    </main>
  );
}
