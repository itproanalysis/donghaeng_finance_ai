"use client";

import { ChevronRight, Headphones, LoaderCircle, MessageCircle, Mic, ShieldCheck, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ApiRequestError, authenticatedFetch, extractInterviewId, readApiEnvelope } from "@/components/api-adapter";
import { unlockQuestionVoicePlayback } from "@/components/question-voice-playback";
import {
  createDevV1AcceptanceRequiredInformationItems,
  createDevV1RequiredInformationItems,
} from "@/domain/information-catalog";
import type { RequiredInformationItem } from "@/domain/interview";

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

export function BorrowerInterviewStart() {
  const router = useRouter();
  const [showProfile, setShowProfile] = useState(false);
  const [showMethods, setShowMethods] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [borrowerName, setBorrowerName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [industryCode, setIndustryCode] = useState<BorrowerIndustry | "">("");
  const [cloudConsent, setCloudConsent] = useState(false);
  const [starting, setStarting] = useState<InterviewMethod | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function recordConsent(interviewId: string, purpose: string, version: string) {
    const response = await authenticatedFetch(`/api/interviews/${encodeURIComponent(interviewId)}/consents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ purpose, consentVersion: version, granted: true, expiresAt: null }),
    });
    await readApiEnvelope(response);
  }

  async function begin(method: InterviewMethod) {
    if (!cloudConsent) {
      setError("답변을 AI가 정리하도록 허용한 뒤 인터뷰를 시작할 수 있습니다.");
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
    setStarting(method);
    setError(null);
    try {
      const baseItems = industryCode === "CAFE"
        ? createDevV1AcceptanceRequiredInformationItems()
        : createDevV1RequiredInformationItems();
      const requiredInformationList: RequiredInformationItem[] = baseItems.map((item) => ({
        ...item,
        priority: item.required ? item.priority : "P2",
        status: item.infoCode === "monthly_average_sales" ? "ASKING" : "NEEDED",
      }));
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
      const interviewId = extractInterviewId(data);
      if (!interviewId) throw new Error("새 인터뷰 식별자를 확인하지 못했습니다.");

      await recordConsent(interviewId, "CLOUD_AI_PROCESSING", CLOUD_AI_CONSENT_VERSION);
      if (method === "voice") {
        await recordConsent(interviewId, "MICROPHONE_INTERVIEW", MICROPHONE_CONSENT_VERSION);
      }
      router.push(
        `/borrower/interviews/${encodeURIComponent(interviewId)}?mode=${method}${
          method === "voice" ? "&autoplay=1" : ""
        }`,
      );
    } catch (caught) {
      if (caught instanceof ApiRequestError && ["AUTHENTICATION_REQUIRED", "SESSION_EXPIRED"].includes(caught.code ?? "")) {
        router.push("/login?next=%2Fborrower");
        return;
      }
      setError(caught instanceof Error ? caught.message : "인터뷰를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      setStarting(null);
    }
  }

  return (
    <main id="main-content" className="borrower-start">
      <section className="borrower-start__hero" aria-labelledby="borrower-start-title">
        <span className="borrower-start__eyebrow"><Sparkles size={16} /> 사장님을 위한 AI 인터뷰</span>
        <h1 id="borrower-start-title">말씀하신 내용을<br />차근차근 정리해 드릴게요.</h1>
        <p>어려운 금융 용어 대신, 사장님의 사업 이야기를 듣고 다음에 필요한 질문을 하나씩 드립니다. 언제든지 직접 확인하고 고칠 수 있어요.</p>
        {!showProfile ? (
          <div className="borrower-start__actions">
            <button type="button" className="borrower-primary-button" onClick={() => setShowProfile(true)}>인터뷰 시작하기 <ChevronRight size={20} /></button>
            <button type="button" className="borrower-text-button" onClick={() => setShowGuide((value) => !value)}>인터뷰 방식 알아보기</button>
          </div>
        ) : !showMethods ? (
          <section className="borrower-profile" aria-labelledby="borrower-profile-title">
            <div className="borrower-methods__heading"><span>시작 전 기본 정보</span><h2 id="borrower-profile-title">어떤 사업 이야기를 들려주실 건가요?</h2><p>첫 질문을 사장님 상황에 맞추기 위한 정보예요. 카드 매출이나 플랫폼 이용을 미리 가정하지 않습니다.</p></div>
            <div className="borrower-profile__fields">
              <label>사장님 성함 또는 호칭<input value={borrowerName} maxLength={80} onChange={(event) => setBorrowerName(event.target.value)} placeholder="예: 김동행" autoComplete="name" /></label>
              <label>사업체 이름<input value={businessName} maxLength={80} onChange={(event) => setBusinessName(event.target.value)} placeholder="예: 동행상점" /></label>
              <label>업종<select value={industryCode} onChange={(event) => setIndustryCode(event.target.value as BorrowerIndustry | "")}><option value="">업종을 선택해 주세요</option>{INDUSTRY_OPTIONS.map((option) => <option key={option.code} value={option.code}>{option.label}</option>)}</select></label>
            </div>
            <div className="borrower-profile__actions"><button type="button" className="borrower-text-button" onClick={() => setShowProfile(false)}>이전</button><button type="button" className="borrower-primary-button" onClick={() => { if (!borrowerName.trim() || !businessName.trim() || !industryCode) { setError("세 가지 기본 정보를 모두 입력해 주세요."); return; } setError(null); setShowMethods(true); }}>답변 방식 선택하기 <ChevronRight size={20} /></button></div>
          </section>
        ) : (
          <section className="borrower-methods" aria-labelledby="borrower-method-title">
            <div className="borrower-methods__heading"><span>마지막 선택</span><h2 id="borrower-method-title">어떤 방식으로 이야기할까요?</h2><p>{businessName} · {INDUSTRY_OPTIONS.find((option) => option.code === industryCode)?.label}</p></div>
            <label className="borrower-consent">
              <input type="checkbox" checked={cloudConsent} onChange={(event) => setCloudConsent(event.target.checked)} />
              <span>제 답변을 Claude AI가 질문 정리와 다음 질문 준비에 사용하는 것에 동의합니다.<small>대출 승인·거절이나 신용등급을 판단하지 않습니다.</small></span>
            </label>
            <div className="borrower-methods__grid">
              <button type="button" className="borrower-method-card" onClick={() => void begin("chat")} disabled={starting !== null}>
                <span className="borrower-method-card__icon"><MessageCircle size={25} /></span><strong>채팅으로 답변</strong><small>조용한 곳에서 천천히 입력할 때</small>{starting === "chat" ? <LoaderCircle className="spin" size={18} /> : <ChevronRight size={18} />}
              </button>
              <button type="button" className="borrower-method-card borrower-method-card--voice" onClick={() => void begin("voice")} disabled={starting !== null}>
                <span className="borrower-method-card__icon"><Mic size={25} /></span><strong>음성으로 답변</strong><small>AI 질문을 듣고 편하게 말할 때</small>{starting === "voice" ? <LoaderCircle className="spin" size={18} /> : <ChevronRight size={18} />}
              </button>
            </div>
            <p className="borrower-methods__voice-note"><Headphones size={15} /> 음성 방식은 AI 질문을 한국어 음성으로 읽어 주며, 내 컴퓨터의 로컬 Whisper가 실제 발화를 전사합니다.</p>
            <button type="button" className="borrower-text-button" onClick={() => setShowMethods(false)}>기본 정보 다시 수정하기</button>
          </section>
        )}
        {error && <p className="borrower-start__error" role="alert">{error}</p>}
      </section>
      <aside className="borrower-start__assurance" aria-label="인터뷰 안내"><ShieldCheck size={22} /><div><strong>사장님이 확인한 내용만 저장합니다.</strong><p>음성 원본은 저장하지 않고, 확정한 답변과 그 근거만 인터뷰 기록에 남습니다.</p></div></aside>
      {showGuide && <section className="borrower-guide" aria-label="인터뷰 방식 안내"><article><span>01</span><h2>AI의 질문을 듣습니다</h2><p>한 번에 질문 하나만 드리고, 듣기 버튼으로 다시 들을 수 있습니다.</p></article><article><span>02</span><h2>편한 방식으로 답합니다</h2><p>채팅 입력과 실제 음성 전사 중 원하는 방식을 고를 수 있습니다.</p></article><article><span>03</span><h2>오른쪽에서 다시 확인합니다</h2><p>했던 질문을 누르면 사장님 답변을 바로 다시 볼 수 있습니다.</p></article></section>}
    </main>
  );
}
