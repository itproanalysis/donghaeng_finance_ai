import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "./about.module.css";

export const metadata: Metadata = {
  title: "서비스 소개",
  description: "동행금융이 금융데이터와 사업 맥락을 변수로 바꾸고, 두 축 평가와 근거로 연결하는 사용자·운영자 흐름을 소개합니다.",
};

const stages = [
  { title: "자료·CB 확인", detail: "금융자료와 부족한 사업 정보" },
  { title: "변수·평가", detail: "현재 상황·개선가능성과 근거" },
  { title: "목표 설정", detail: "측정할 변수·목표값·기간" },
  { title: "수행기록", detail: "목표 기간의 거래·실행 자료" },
  { title: "재평가", detail: "새 자료로 같은 변수 재산출" },
  { title: "기관 검토 준비", detail: "결과·보완자료·검토 의견" },
];

const flows = [
  { phase: "자료 확인", user: "사업 현황과 변동 이유를 설명합니다. 모름·거절도 선택할 수 있습니다.", operator: "자료의 출처·기간·누락과 추가 확인할 내용을 검토합니다." },
  { phase: "변수·평가", user: "정리된 내용과 평가에 쓰인 근거를 확인합니다.", operator: "원문→변수→평가항목을 대조하고, 배점과 제외 사유를 확인합니다." },
  { phase: "목표 설정", user: "개선할 항목, 목표값과 실행 기간을 정합니다.", operator: "같은 데이터로 측정 가능한 목표인지, 계획이 현실적인지 확인합니다." },
  { phase: "수행기록", user: "계획을 수행하고 매출·거래 등 증빙자료를 모읍니다.", operator: "수기 기록과 거래자료를 구분하고 목표 변수의 변화를 확인합니다." },
  { phase: "재평가", user: "목표 달성 여부와 현재 상태를 확인합니다.", operator: "새 자료로 변수를 재산출하고 바뀐 점수·배점·분모를 검토합니다." },
  { phase: "후속 검토", user: "금융 상담에 필요한 보완 자료와 의견을 확인합니다.", operator: "검토 요약을 준비합니다. 실제 기관 전달과 상품 연결은 후속 연계 범위입니다." },
];

export default function AboutPage() {
  return <main id="main-content" className={styles.page}>
    <header className={styles.intro}>
      <h1>서비스 소개</h1>
      <p>동행금융은 <strong>신용정보만으로 설명하기 어려운 소상공인의 사업 변화와 실행 기록</strong>을 평가 근거로 정리합니다. 금융자료와 사업 맥락을 변수화해 현재 상황·개선가능성을 산출하고, 목표 수행 이후 같은 변수로 재평가합니다. 이를 금융기관의 추가 검토 자료로 연결하는 것이 서비스의 목적입니다.</p>
    </header>

    <section className={styles.pipeline} aria-labelledby="about-process-title">
      <div className={styles.sectionHeading}><h2 id="about-process-title">전체 과정</h2></div>
      <ol>{stages.map(({ title, detail }, index) => <li key={title}><span className={styles.stepNumber}>{String(index + 1).padStart(2, "0")}</span><h3>{title}</h3><p>{detail}</p>{index < stages.length - 1 && <ArrowRight className={styles.flowArrow} size={16} aria-hidden="true" />}</li>)}</ol>
    </section>

    <section className={styles.flows} aria-labelledby="about-flow-title">
      <div className={styles.sectionHeading}><h2 id="about-flow-title">사용자와 운영자의 진행 흐름</h2></div>
      <div className={styles.flowLabels}><span>진행 단계</span><strong>사용자 · 소상공인</strong><strong>운영자 · 상담·검토 담당자</strong></div>
      <ol>{flows.map((flow, index) => <li key={flow.phase}><span className={styles.phase}>{index + 1}. {flow.phase}</span><div><small>사용자</small><p>{flow.user}</p></div><div><small>운영자</small><p>{flow.operator}</p></div></li>)}</ol>
    </section>

    <section className={styles.scope} aria-labelledby="about-scope-title">
      <div className={styles.sectionHeading}><h2 id="about-scope-title">현재 제공 기능</h2></div>
      <div><article><span>평가·후속 검토</span><h3>합성 사례로 평가에서 검토 요약까지</h3><p>10개 사례의 94개 변수와 배점 근거를 확인합니다. 영업일 감소 사례는 6개월 수행자료와 재평가를 연결하고, 담당자 의견을 담은 요약을 인쇄하거나 내려받을 수 있습니다.</p><Link href="/modeling?case=case_operating_drop&tab=impact">평가 반영 보기 <ArrowRight size={16} /></Link><Link href="/modeling?case=case_operating_drop&tab=goals">목표·수행기록 보기 <ArrowRight size={16} /></Link></article><article><span>직접 입력 체험</span><h3>사업 현황을 답하고 기록 확인</h3><p>가입·Google 로그인 없이 답변을 입력하고 AI가 구조화한 내용과 원문을 확인합니다. 체험 기록과 검토 메모는 다른 방문자와 공유되지 않습니다.</p><Link href="/borrower?scenario=operating-day">답변 → 변수 → 점수 시연 <ArrowRight size={16} /></Link><Link href="/borrower?entry=sample">직접 입력 <ArrowRight size={16} /></Link><Link href="/interviews">내 브라우저의 기록 <ArrowRight size={16} /></Link></article></div>
      <p className={styles.boundary}>등록된 합성 시연은 완료한 답변을 같은 합성 거래자료에 결합해 점수를 계산합니다. 일반 입력에는 거래자료가 연결되어 있지 않습니다. 실제 은행 연동·상품 추천·대출중개·기관 전송은 후속 구현 범위입니다. 현재 점수는 신용등급·승인 확률이 아니며 실제 상환 결과를 통한 예측 성능은 아직 검증하지 않았습니다.</p>
    </section>
    <footer className={styles.footer}><Link href="/modeling?case=case_operating_drop&tab=impact">모델링 결과 확인 <ArrowRight size={18} /></Link><Link href="/">첫 화면</Link></footer>
  </main>;
}
