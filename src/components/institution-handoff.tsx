import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "@/app/data-engine.module.css";

export function InstitutionHandoff({ interviewId }: { interviewId: string }) {
  return <section className={styles.handoff} aria-label="금융기관 상담 연결">
    <h2>금융기관 검토자료를 만드세요.</h2>
    <p>사업 현황·평가 근거·개선 계획·실행 기록과 담당자 의견을 한 검토서에 담습니다. 원문과 변수의 연결을 확인하고 최종 자료로 저장할 수 있습니다.</p>
    <div className={styles.actions}><Link href={`/demo/admin?interview=${encodeURIComponent(interviewId)}`}>금융기관 검토자료 만들기 <ArrowRight size={16} /></Link></div>
    <p className={styles.small}>실행 기록이 없어도 현재 결과로 준비할 수 있습니다. 기관에 자동 전송되거나 상담이 접수되지는 않습니다.</p>
  </section>;
}
