"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Compass,
  FileCheck,
  ShieldCheck,
} from "lucide-react";

export function AdminDemo() {
  const [copied, setCopied] = useState(false);

  function copyReviewSummary() {
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="alley-dialogue-screen" style={{ minHeight: "100vh", padding: "0 24px 60px" }}>
      <header className="alley-dialogue-topbar">
        <Link href="/" className="alley-dialogue-brand" aria-label="동행금융 처음으로">
          동행금융
        </Link>
        <div className="alley-dialogue-status">금융기관 상담 검토 파일 · 심사역 시점</div>
        <div style={{ display: "flex", gap: "10px" }}>
          <Link href="/demo" className="alley-dialogue-exit">
            <Compass size={14} /> 동행 대화 이어보기
          </Link>
          <Link href="/" className="alley-dialogue-exit">
            <ArrowLeft size={14} /> 골목길로
          </Link>
        </div>
      </header>

      <div style={{ width: "min(1080px, 100%)", margin: "20px auto 0", zIndex: 5 }}>
        {/* Top Hero Banner */}
        <section className="result-banner">
          <FileCheck size={42} />
          <div>
            <span>심사역 검토 요약 · 가상 사례 (CASE 001)</span>
            <h1>동행카페 지원님 회복 근거 파일</h1>
            <p>
              단순 신용점수만으로는 알 수 없었던 사업 재개 맥락과 구체적 지출 조정 의지가 사장님의 구술 대화를 통해 3대 회복 근거로 정리되었습니다.
            </p>
          </div>
          <button
            type="button"
            className="dh-button dh-button--white"
            onClick={copyReviewSummary}
          >
            {copied ? "검토서 복사 완료!" : "상담 요약서 복사"}
          </button>
        </section>

        {/* 3 Core Recovery Pillars */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "18px", margin: "28px 0" }}>
          {/* Pillar 1 */}
          <article
            style={{
              background: "#ffffff",
              border: "1px solid rgba(212, 178, 126, 0.45)",
              borderRadius: "20px",
              padding: "26px",
              boxShadow: "0 6px 20px rgba(23, 58, 50, 0.05)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ color: "var(--route-gold-text, #a8793b)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.06em" }}>
              근거 01 · 상황과 변화 원인
            </span>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", color: "var(--forest-ink)", margin: "10px 0 8px" }}>
              사업 공백과 매출 회복
            </h2>
            <div
              style={{
                background: "linear-gradient(135deg, rgba(255, 248, 232, 0.85), #fffdf8)",
                borderLeft: "3px solid var(--route-gold)",
                borderRadius: "0 8px 8px 0",
                padding: "12px 14px",
                margin: "8px 0 14px",
              }}
            >
              <p style={{ margin: 0, fontSize: "13px", color: "var(--forest-ink)", lineHeight: "1.55" }}>
                “리뉴얼 후 다시 영업을 시작했어요. 최근 3개월 매출이 안정적으로 이어지고 있습니다.”
              </p>
              <small style={{ color: "var(--text-muted)", fontSize: "11px" }}>사장님 구술 진술 원문</small>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-soft)", lineHeight: "1.6" }}>
              <strong>심사 검토 의견:</strong> 단순 영업 부진이 아닌 매장 리뉴얼을 위한 일시 휴업이었으며, 재오픈 이후 단골 고객 유입으로 정상 영업 궤도에 진입한 상태임.
            </p>
          </article>

          {/* Pillar 2 */}
          <article
            style={{
              background: "#ffffff",
              border: "1px solid rgba(212, 178, 126, 0.45)",
              borderRadius: "20px",
              padding: "26px",
              boxShadow: "0 6px 20px rgba(23, 58, 50, 0.05)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ color: "var(--route-gold-text, #a8793b)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.06em" }}>
              근거 02 · 현금흐름 습관
            </span>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", color: "var(--forest-ink)", margin: "10px 0 8px" }}>
              월 자금 흐름과 첫 목표
            </h2>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: "8px",
                background: "rgba(23, 58, 50, 0.04)",
                padding: "12px",
                borderRadius: "10px",
                margin: "8px 0 14px",
              }}
            >
              <div>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>월평균 매출</span>
                <strong style={{ display: "block", fontSize: "16px", color: "var(--forest-ink)" }}>2,200만 원</strong>
              </div>
              <div>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>재료비+고정비</span>
                <strong style={{ display: "block", fontSize: "16px", color: "var(--forest-ink)" }}>1,550만 원</strong>
              </div>
              <div>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>월 상환 가능액</span>
                <strong style={{ display: "block", fontSize: "16px", color: "var(--companion-green)" }}>470만 원</strong>
              </div>
              <div>
                <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>조정 지출</span>
                <strong style={{ display: "block", fontSize: "16px", color: "var(--amber)" }}>원재료·소모품</strong>
              </div>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-soft)", lineHeight: "1.6" }}>
              <strong>상환 여력 판단:</strong> 고정비 차감 후 월 470만 원의 실질 잔여 자금이 발생하며, 원재료비 지출 절감 의지가 확인되어 상환 안정성이 양호함.
            </p>
          </article>

          {/* Pillar 3 */}
          <article
            style={{
              background: "#ffffff",
              border: "1px solid rgba(212, 178, 126, 0.45)",
              borderRadius: "20px",
              padding: "26px",
              boxShadow: "0 6px 20px rgba(23, 58, 50, 0.05)",
              display: "flex",
              flexDirection: "column",
            }}
          >
            <span style={{ color: "var(--route-gold-text, #a8793b)", fontSize: "11px", fontWeight: 800, letterSpacing: "0.06em" }}>
              근거 03 · 금융 상담 준비 증빙
            </span>
            <h2 style={{ fontFamily: "var(--font-display)", fontSize: "20px", color: "var(--forest-ink)", margin: "10px 0 8px" }}>
              제출 준비 자료 패키지
            </h2>
            <ul style={{ listStyle: "none", padding: 0, margin: "8px 0 14px", display: "grid", gap: "10px" }}>
              <li style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--forest-ink)" }}>
                <CheckCircle2 size={16} color="var(--companion-green)" />
                <span>최근 3개월 카드 매출 정산서 (구비 완료)</span>
              </li>
              <li style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--forest-ink)" }}>
                <CheckCircle2 size={16} color="var(--companion-green)" />
                <span>임대차 계약서 및 리뉴얼 공사 영수증</span>
              </li>
              <li style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--forest-ink)" }}>
                <CheckCircle2 size={16} color="var(--companion-green)" />
                <span>향후 12개월 상환 계획표 작성 완료</span>
              </li>
            </ul>
            <p style={{ margin: 0, fontSize: "13px", color: "var(--text-soft)", lineHeight: "1.6" }}>
              <strong>상담 자료 상태:</strong> 금융기관 심사역이 현장 심사 없이도 즉시 차주의 회복 가능성을 검토할 수 있도록 필수 증빙이 사전에 준비됨.
            </p>
          </article>
        </div>

        {/* Bottom Actions and Assurance */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "24px 30px",
            background: "linear-gradient(135deg, rgba(255, 248, 232, 0.95), #fffdf8)",
            border: "1px solid rgba(212, 178, 126, 0.45)",
            borderRadius: "18px",
            boxShadow: "0 4px 16px rgba(23, 58, 50, 0.05)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <ShieldCheck size={26} color="var(--companion-green)" />
            <div>
              <strong style={{ display: "block", color: "var(--forest-ink)", fontSize: "14px" }}>
                금융기관 심사역 전달 안내
              </strong>
              <small style={{ color: "var(--text-soft)", fontSize: "12px" }}>
                본 파일은 대출 자동 승인 결정이 아니며, 사람이 맥락을 살피고 회복을 지원하기 위한 상담 기초자료입니다.
              </small>
            </div>
          </div>
          <div style={{ display: "flex", gap: "12px" }}>
            <Link href="/demo" className="dh-button">
              <Compass size={15} /> 동행 대화 화면으로 <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
