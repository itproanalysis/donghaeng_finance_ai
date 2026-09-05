import { ArrowRight, ClipboardCheck, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { StartInterviewButton } from "@/components/start-interview-button";
import { AdminOperationsBoard } from "@/components/admin-operations-board";

export const metadata: Metadata = {
  title: "상담 대장",
};

export default function InterviewIndexPage() {
  return (
    <main id="main-content" className="workspace-page admin-entry-page">
      <header className="admin-entry-hero">
        <div>
          <p className="panel-kicker">상담 관리</p>
          <h1>상담 대장</h1>
          <p>진행 중인 인터뷰와 확인할 기록을 살펴봅니다.</p>
        </div>
        <Link className="admin-entry-hero__link" href="/interview-evaluations">
          <ClipboardCheck size={17} /> 완료된 인터뷰 검토 <ArrowRight size={16} />
        </Link>
      </header>

      <AdminOperationsBoard />
      <details className="admin-intake">
        <summary>새 인터뷰 접수 <span>사장님·사업체·업종 등록</span></summary>
      <section className="interview-entry" id="new-interview" aria-labelledby="interview-entry-heading" tabIndex={-1}>
        <div className="interview-entry__copy">
          <h2 id="interview-entry-heading">대상 가게를 등록해 주세요</h2>
          <p>등록한 업종에 맞춰 질문을 준비합니다.</p>
        </div>
        <StartInterviewButton />
      </section>
      </details>

      <div className="decision-boundary-note interview-entry__boundary">
        <ShieldCheck size={17} aria-hidden="true" />
        <p>인터뷰 결과는 공식 CB와 분리된 상담 보조정보이며 승인·거절이나 신용등급을 자동으로 결정하지 않습니다.</p>
      </div>
    </main>
  );
}
