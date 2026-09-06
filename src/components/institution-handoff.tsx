import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "@/app/data-engine.module.css";

export function InstitutionHandoff({ interviewId }: { interviewId: string }) {
  return <section className={styles.handoff} aria-label="금융기관 상담 연결">
    <h2>이 결과로 금융기관 상담을 준비하세요.</h2>
    <p>사업 현황과 원문 근거, 선택한 계획과 실행 기록을 한 준비서에 담습니다. 상담할 기관을 고르고 자료를 챙겨 공식 상담 창구로 이어갈 수 있습니다.</p>
    <div className={styles.actions}><Link href={`/consultation/${encodeURIComponent(interviewId)}`}>상담 준비서 만들기 <ArrowRight size={16} /></Link></div>
    <p className={styles.small}>실행 기록이 없어도 현재 결과로 준비할 수 있습니다. 기관에 자동 전송되거나 상담이 접수되지는 않습니다.</p>
  </section>;
}
