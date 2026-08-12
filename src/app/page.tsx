import { ArrowRight, Building2, MessageCircleHeart, ShieldCheck } from "lucide-react";
import Link from "next/link";

export default function HomePage() {
  return (
    <main id="main-content" className="role-home">
      <section className="role-home__intro">
        <span>동행금융AI</span>
        <h1>어떤 화면으로 시작할까요?</h1>
        <p>사장님에게는 쉬운 대화만, 관리자에게는 필요한 확인 도구만 보여 드립니다.</p>
      </section>
      <section className="role-home__choices" aria-label="사용자 화면 선택">
        <Link href="/borrower" className="role-choice role-choice--borrower">
          <span className="role-choice__icon"><MessageCircleHeart size={28} /></span>
          <span>사장님 인터뷰</span>
          <strong>AI와 편하게 이야기하고<br />내 답변을 직접 확인합니다.</strong>
          <small>채팅 또는 실제 음성 인터뷰</small>
          <i>시작하기 <ArrowRight size={17} /></i>
        </Link>
        <Link href="/interviews" className="role-choice role-choice--admin">
          <span className="role-choice__icon"><Building2 size={28} /></span>
          <span>관리자 센터</span>
          <strong>인터뷰 진행 상태와<br />근거·평가를 검토합니다.</strong>
          <small>상담사 및 운영 담당자용</small>
          <i>관리 화면 열기 <ArrowRight size={17} /></i>
        </Link>
      </section>
      <p className="role-home__notice"><ShieldCheck size={15} /> 인터뷰는 대출 승인·거절이나 신용등급을 자동으로 결정하지 않습니다.</p>
    </main>
  );
}
