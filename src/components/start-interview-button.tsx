"use client";

import { ArrowRight, LoaderCircle, Play } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ApiRequestError,
  authenticatedFetch,
  extractInterviewId,
  readApiEnvelope,
} from "@/components/api-adapter";
import {
  createDevV1AcceptanceRequiredInformationItems,
  createDevV1RequiredInformationItems,
} from "@/domain/information-catalog";
import {
  SOHO_INDUSTRY_CATALOG,
  type SohoIndustryCode,
} from "@/domain/soho-industry-catalog";

export function StartInterviewButton() {
  const router = useRouter();
  const [isStarting, setIsStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [industryCode, setIndustryCode] = useState<SohoIndustryCode | "">("");
  const [borrowerName, setBorrowerName] = useState("");
  const [businessName, setBusinessName] = useState("");

  const industryProfile =
    SOHO_INDUSTRY_CATALOG.find((profile) => profile.code === industryCode);

  async function startInterview() {
    const normalizedBorrowerName = borrowerName.trim();
    const normalizedBusinessName = businessName.trim();
    if (!normalizedBorrowerName || !normalizedBusinessName || !industryCode) {
      setError("대상 사장님과 사업체 이름을 입력하고 업종을 선택해 주세요.");
      return;
    }
    setIsStarting(true);
    setError(null);

    try {
      const response = await authenticatedFetch("/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          industryCode,
          requiredInformationList:
            industryCode === "CAFE"
              ? createDevV1AcceptanceRequiredInformationItems()
              : createDevV1RequiredInformationItems(),
          profile: {
            borrowerName: normalizedBorrowerName,
            businessName: normalizedBusinessName,
          },
        }),
      });
      const data = await readApiEnvelope(response);
      const interviewId = extractInterviewId(data);

      if (!interviewId) {
        throw new Error("생성된 인터뷰 식별자를 확인할 수 없습니다.");
      }

      router.push(`/interviews/${encodeURIComponent(interviewId)}`);
    } catch (caught) {
      if (
        caught instanceof ApiRequestError &&
        ["AUTHENTICATION_REQUIRED", "SESSION_EXPIRED"].includes(caught.code ?? "")
      ) {
        router.push("/login?next=%2Finterviews");
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "인터뷰를 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
      setIsStarting(false);
    }
  }

  return (
    <div className="start-action">
      <label className="start-action__identity">
        <span>사장님 성함 또는 호칭</span>
        <input
          value={borrowerName}
          onChange={(event) => setBorrowerName(event.target.value)}
          maxLength={80}
          autoComplete="name"
          placeholder="예: 김동행"
          disabled={isStarting}
        />
      </label>
      <label className="start-action__identity">
        <span>사업체 이름</span>
        <input
          value={businessName}
          onChange={(event) => setBusinessName(event.target.value)}
          maxLength={80}
          placeholder="예: 동행상점"
          disabled={isStarting}
        />
      </label>
      <label className="start-action__industry">
        <span>사장님이 확인한 업종</span>
        <select
          value={industryCode}
          onChange={(event) => setIndustryCode(event.target.value as SohoIndustryCode)}
          disabled={isStarting}
        >
          <option value="" disabled>업종을 선택해 주세요</option>
          {SOHO_INDUSTRY_CATALOG.map((profile) => (
            <option value={profile.code} key={profile.code}>
              {profile.label}
            </option>
          ))}
        </select>
      </label>
      {industryProfile && <details className="start-action__profile">
        <summary>{industryProfile.label} 질문 준비 내용</summary>
        <span>후보 정보 {industryProfile.industryInformationItems.length}개</span>
        <span>목표 후보 {industryProfile.goalCandidates.length}개</span>
        <p>{industryProfile.goalCandidates.map((goal) => goal.title).join(" · ")}</p>
        <small>
          업종에 맞는 제안 후보입니다. 사장님이 확인하지 않은 내용은 실제 사업 정보로 확정하지 않습니다.
        </small>
      </details>}
      <button
        className="button button--primary button--large"
        type="button"
        onClick={startInterview}
        disabled={isStarting}
      >
        {isStarting ? (
          <LoaderCircle className="spin" size={19} aria-hidden="true" />
        ) : (
          <Play size={18} fill="currentColor" aria-hidden="true" />
        )}
        {isStarting ? "인터뷰 준비 중" : "관리자 인터뷰 만들기"}
        {!isStarting && <ArrowRight size={18} aria-hidden="true" />}
      </button>
      <p className="start-action__hint">
        실제 답변과 확인 상태를 함께 기록합니다. 정보가 없는 항목을 임의로 채우지 않습니다.
      </p>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
