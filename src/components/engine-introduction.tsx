import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "@/app/data-engine.module.css";

export function DataComparison() {
  return <section aria-labelledby="comparison-title"><h2 id="comparison-title">기존 금융정보에 사업 맥락을 더합니다.</h2><div className={styles.compare}><article><h3>기존 평가 정보</h3><ul>{["매출", "대출", "연체", "카드", "거래"].map((item) => <li key={item}>{item}</li>)}</ul></article><article><h3>동행금융 추가 정보</h3><ul>{["매출 변화 이유 · 최근 회복 흐름", "반복 고객 · 확정 예약 / 수주", "비용 조정 가능성 · 실행 계획", "계획 기간 · 준비된 증빙 · 제약사항"].map((item) => <li key={item}>{item}</li>)}</ul><p className={styles.small}>인터뷰에서 직접 확인한 정보만 기록합니다. 모든 설명이 현재 v2 숫자 Feature로 변환되는 것은 아닙니다.</p></article></div><p className={styles.scope}>기존 금융정보를 대체하지 않습니다. 기존 데이터에 없던 사업 맥락을 추가합니다.</p></section>;
}
export function EngineArchitecture({ open = false }: { open?: boolean }) {
  return <details className={styles.architecture} open={open}><summary>기술 구조 · AI / SERVER / HUMAN</summary><div><article><h3>AI · 대화 인터페이스</h3><p>허용된 질문 선택<br />자연스러운 인터뷰 반응<br />비정형 대화 · 음성</p></article><article><h3>SERVER · 검증과 변환</h3><p>Canonical Information · Evidence<br />Feature Engineering · Missingness<br />State Transition · Completion · Evaluation</p></article><article><h3>HUMAN · 판단</h3><p>사업자의 개선 Action 선택<br />담당자의 추가 확인<br />금융기관 최종 판단</p></article></div><p>AI가 금융 판단을 만드는 구조가 아니라, AI가 기존에 수집하기 어려웠던 정보를 수집하고 서버가 검증 가능한 형태로 변환하는 구조입니다.</p></details>;
}
export function EngineHome() {
  return <main id="main-content" className={styles.page}>
    <section className={styles.hero}><div><p className={styles.eyebrow}>동행금융AI · Competition Demo / Synthetic Data</p><h1>점수에 없던 사업 정보를,<br />검토할 수 있는 데이터로.</h1><p>소상공인의 회복 이유와 실행 계획을 AI 인터뷰로 수집합니다. 비정형 발화를 근거 추적 가능한 금융 Feature와 Evidence로 바꾸어 금융기관의 정보 공백을 보완합니다.</p><div className={styles.actions}><Link href="/judge-demo">3분 기술 데모 시작 <ArrowRight size={18} /></Link><Link href="/about">서비스 소개</Link></div><p className={styles.small}>가입·Google 로그인 없이 합성 사례로 체험합니다.</p><div className={styles.pipeline}><span>AI Interview</span><ArrowRight size={15} /><span>Alternative Data</span><ArrowRight size={15} /><span>Financial Features</span></div></div><article className={styles.gapCard}><p className={styles.eyebrow}>기존 금융평가의 정보 공백</p><h2>신용정보에서 확인하는 것</h2><ul>{["연체", "대출", "카드", "거래"].map((item) => <li key={item}>✓ {item}</li>)}</ul><hr /><h2>숫자만으로 알기 어려운 것</h2><ul>{["매출 회복 이유", "반복고객 변화", "신규 예약·수주", "비용 조정 계획", "실행 시작일", "준비된 증빙"].map((item) => <li key={item}>? {item}</li>)}</ul><p className={styles.small}>대화에서 확인하고, 확인되지 않은 정보는 MISSING으로 남깁니다.</p></article></section>
    <p className={styles.scope}>동행금융AI는 대출 승인·거절 또는 신용등급을 생성하지 않습니다.<br />인터뷰에서 확보한 추가 정보를 구조화하여 사람이 검토할 수 있게 합니다.</p>
    <section className={styles.process}><h2>한 번의 인터뷰가 다음 행동으로 이어집니다.</h2><ol>{[["AI 인터뷰", "사장님의 말에서 사업 정보를 수집"], ["정보 구조화", "원문 Evidence와 Canonical 연결"], ["Feature 생성", "서버 산식과 누락 상태 공개"], ["Signal · 설명", "계산 입력과 정보의 제약 확인"], ["개선 Action", "사업자가 직접 선택"], ["Recovery Mission", "새 실행기록을 Evidence로 보존"]].map(([title, detail], index) => <li key={title}><span>0{index + 1}</span><strong>{title}</strong><p>{detail}</p></li>)}</ol></section>
    <DataComparison /><EngineArchitecture />
    <nav className={styles.secondaryLinks} aria-label="추가 체험"><Link href="/borrower?entry=sample">음성·텍스트 전체 인터뷰</Link><Link href="/review">금융기관 관점에서 검토</Link><Link href="/modeling?case=case_operating_drop&tab=impact">별도 합성 거래자료의 규칙 산출 실험</Link></nav>
    <footer className={styles.small}><p>현재 환경은 공모전용 합성 데이터 데모입니다. 실제 고객정보·실명·계좌번호를 입력하지 마세요. 금융기관 데이터 연동과 실제 대출 판단은 제공하지 않습니다.</p><p>공개 체험은 9월 12일 0시(한국 시간)까지 제공됩니다. 이 브라우저의 쿠키로 기록에 접근하며 다른 방문자의 기록은 보이지 않습니다.</p></footer>
  </main>;
}
