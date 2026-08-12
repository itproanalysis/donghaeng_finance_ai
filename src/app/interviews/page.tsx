import { MessageSquareText, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";

import { StartInterviewButton } from "@/components/start-interview-button";

export const metadata: Metadata = {
  title: "AI인터뷰",
};

export default function InterviewIndexPage() {
  return (
    <main id="main-content" className="workspace-page">
      <section className="interview-entry" aria-labelledby="interview-entry-heading">
        <div className="interview-entry__icon" aria-hidden="true">
          <MessageSquareText size={25} />
        </div>
        <div className="interview-entry__copy">
          <p className="panel-kicker">ADMIN INTERVIEW CENTER</p>
          <h1 id="interview-entry-heading">관리자 인터뷰 센터</h1>
          <p>
            상담사·운영 담당자가 인터뷰의 진행 상태, 수집 근거와 평가 결과를 검토하는 화면입니다.
            사장님 전용의 단순 인터뷰는 홈에서 별도로 시작할 수 있습니다.
          </p>
        </div>
        <StartInterviewButton />
      </section>

      <div className="decision-boundary-note interview-entry__boundary">
        <ShieldCheck size={16} aria-hidden="true" />
        <p>
          인터뷰 결과는 공식 CB와 분리된 상담 보조정보입니다. 승인·거절이나
          신용등급을 자동으로 결정하지 않습니다.
        </p>
      </div>
    </main>
  );
}
