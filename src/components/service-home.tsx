import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { getModelingCase } from "@/server/modeling-demo";
import styles from "@/app/service-home.module.css";

const examples = [
  { id: "case_operating_drop", label: "영업일 감소", cause: "휴업 사유 해소" },
  { id: "case_customer_drop", label: "손님 감소", cause: "결제 건수 감소" },
  { id: "case_ticket_drop", label: "객단가 하락", cause: "결제 단가 감소" },
  { id: "case_no_answer", label: "추가 설명 없음", cause: "변화 원인 미확인" },
];

export function ServiceHome() {
  const example = getModelingCase("case_operating_drop")!;
  return <main id="main-content" className={styles.page}>
    <section className={styles.intro} aria-labelledby="entrance-heading">
      <div className={styles.copy}>
        <p className={styles.category}>동행금융</p>
        <h1 id="entrance-heading">사업의 변화를<br />평가의 근거로.</h1>
        <p className={styles.description}>신용정보에 담기지 않은 소상공인의 사업 현황과 실행 기록을 정리합니다. 데이터로 목표 수행을 확인하고, 재평가와 금융기관 검토를 준비합니다.</p>
        <div className={styles.actions}>
          <Link href="/modeling?case=case_operating_drop&tab=impact">평가 사례 살펴보기 <ArrowRight size={18} /></Link>
          <Link href="/about">서비스 소개</Link>
        </div>
        <p className={styles.access}>가입·Google 로그인 없이 이용</p>
      </div>
      <article className={styles.example} aria-label="영업일 감소 사례의 분석 결과 예시">
        <header><span>분석 예시</span><small>합성 사례 03</small></header>
        <h2>영업일 감소로 매출이 줄어든 가게</h2>
        <p>최근 매출 −20% · 휴업 사유 해소</p>
        <dl className={styles.scores}>
          <div><dt>현재 상황</dt><dd>{example.scorecard.currentSituation.score}<small>/100</small></dd></div>
          <div><dt>개선가능성</dt><dd>{example.scorecard.improvement.score}<small>/100</small></dd></div>
        </dl>
        <dl className={styles.accounting}>
          <div><dt>개선가능성 산출</dt><dd>{example.scorecard.improvement.accounting.earnedPoints} ÷ {example.scorecard.improvement.accounting.availablePoints} × 100</dd></div>
          <div><dt>반영한 평가항목</dt><dd>{example.scorecard.improvement.itemsUsed}개 / {example.scorecard.improvement.itemsTotal}개</dd></div>
        </dl>
        <Link href="/modeling?case=case_operating_drop&tab=impact">변수와 산출 근거 확인 <ArrowRight size={16} /></Link>
        <div className={styles.followupLink}><span>평가 이후에는</span><Link href="/modeling?case=case_operating_drop&tab=goals">목표 설정과 6개월 수행기록 <ArrowRight size={15} /></Link></div>
      </article>
    </section>

    <section className={styles.cases} aria-labelledby="home-cases-heading">
      <header><h2 id="home-cases-heading">매출이 20% 줄어도, 이유는 다릅니다.</h2><p>거래 건수·객단가·영업일을 구분하고 추가 설명을 변수로 반영한 사례입니다.</p></header>
      <div className={styles.tableWrap}><table><thead><tr><th>사례</th><th>감소 원인 및 맥락</th><th>현재 상황</th><th>개선가능성</th><th>산출식</th><th><span className="sr-only">사례 열기</span></th></tr></thead><tbody>
        {examples.map(({ id, label, cause }) => { const item = getModelingCase(id)!; const accounting = item.scorecard.improvement.accounting; return <tr key={id}><th scope="row">{label}</th><td><small>{cause}</small></td><td>{item.scorecard.currentSituation.score}점</td><td><strong>{item.scorecard.improvement.score}점</strong></td><td><small>{accounting.earnedPoints} ÷ {accounting.availablePoints} × 100</small></td><td><Link href={`/modeling?case=${id}&tab=impact`} aria-label={`${label} 분석 보기`}>분석 보기 <ArrowRight size={15} /></Link></td></tr>; })}
      </tbody></table></div>
      <p className={styles.note}>합성 데이터의 규칙 산출 예시입니다. 신용등급이나 대출 승인 확률을 뜻하지 않습니다.</p>
    </section>

    <section className={styles.process} aria-labelledby="home-process-heading">
      <h2 id="home-process-heading">이용 과정</h2>
      <ol>{[
        { title: "자료·CB 확인", detail: "출처·기간·빠진 정보를 확인합니다.", tab: "data" },
        { title: "변수·평가", detail: "사업 맥락을 반영한 배점과 근거를 검토합니다.", tab: "impact" },
        { title: "목표·수행기록", detail: "같은 변수로 측정할 목표와 자료를 확인합니다.", tab: "goals" },
        { title: "재평가", detail: "새 거래자료로 변수와 평가를 다시 산출합니다.", tab: "reevaluation" },
        { title: "기관 검토 준비", detail: "결과·보완자료·담당자 의견을 요약합니다.", tab: "report" },
      ].map((step, index) => <li key={step.tab}><span>{String(index + 1).padStart(2, "0")}</span><div><h3><Link href={`/modeling?case=case_operating_drop&tab=${step.tab}`}>{step.title}</Link></h3><p>{step.detail}</p></div></li>)}</ol>
    </section>

    <section className={styles.experience} aria-labelledby="home-experience-heading">
      <div><h2 id="home-experience-heading">내 사업 현황 입력 체험</h2><p>가상 카페로 시작해 답변을 직접 입력하고 정리된 상담 기록을 확인합니다.</p></div>
      <nav aria-label="직접 입력 체험"><Link href="/borrower?entry=sample">가입 없이 바로 체험 <ArrowRight size={16} /></Link><Link href="/borrower?scenario=operating-day">답변 → 변수 → 점수 시연 <ArrowRight size={16} /></Link><Link href="/interviews">내 상담 기록</Link></nav>
    </section>
    <footer className={styles.footer}>
      <p>합성 사례로 평가·목표·재평가·검토 요약을 제공합니다. 등록된 시연은 답변을 합성 거래자료에 연결합니다. 일반 상담의 은행 연동과 대출중개는 제공하지 않습니다.</p>
      <details><summary>공개 체험 이용 안내</summary><p>공개 체험은 9월 12일 0시(한국 시간)까지 이용할 수 있습니다. 상담 기록은 이 브라우저에 연결되며 쿠키를 지우면 다시 열 수 없습니다. 실명·계좌번호 등 민감한 정보는 입력하지 마세요. 음성 통화는 회당 10분, 방문자당 하루 2회이며 이용량에 따라 제한될 수 있습니다.</p></details>
    </footer>
  </main>;
}
