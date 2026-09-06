import Link from "next/link";
import { ArrowRight } from "lucide-react";
import styles from "@/app/data-engine.module.css";

export function DataComparison() {
  return <section aria-labelledby="comparison-title"><h2 id="comparison-title">숫자에 사업의 사정을 더합니다.</h2><div className={styles.compare}><article><h3>기존 금융정보</h3><ul>{["매출", "대출", "연체", "카드", "거래"].map((item) => <li key={item}>{item}</li>)}</ul></article><article><h3>함께 확인할 사업 정보</h3><ul>{["매출 변화 이유와 최근 회복 흐름", "반복 고객과 확정 예약·수주", "비용 조정 계획과 실행 시점", "준비한 증빙과 실행의 제약"].map((item) => <li key={item}>{item}</li>)}</ul><p className={styles.small}>대화에서 확인한 내용과 아직 확인할 내용을 구분합니다.</p></article></div><p className={styles.scope}>기존 금융정보를 대체하지 않습니다. 기존 데이터에 없던 사업 맥락을 추가합니다.</p></section>;
}
export function EngineArchitecture({ open = false }: { open?: boolean }) {
  return <details className={styles.architecture} open={open}><summary>정보가 만들어지는 방식 · AI / SERVER / HUMAN</summary><div><article><h3>대화 · AI</h3><p>질문 선택<br />인터뷰 응답<br />음성·텍스트 입력</p></article><article><h3>검증·변환 · SERVER</h3><p>Canonical Information · Evidence<br />Feature Engineering · Missingness<br />State Transition · Completion · Evaluation</p></article><article><h3>확인·판단 · HUMAN</h3><p>사업자의 정보 확인과 계획 선택<br />담당자의 근거 검토<br />금융기관 최종 판단</p></article></div><p>대화로 수집한 정보는 서버에서 원문과 연결해 변수로 변환합니다. 각 값의 출처와 계산 과정을 확인할 수 있습니다.</p></details>;
}
export function EngineHome() {
  return <main id="main-content" className={styles.page}>
    <section className={styles.hero}><div><p className={styles.eyebrow}>동행금융 · 사업 정보와 금융상담</p><h1>사업 현황을 정리하고,<br />금융상담을 준비하세요.</h1><p>매출이 달라진 이유, 단골 고객의 변화, 앞으로의 계획을 이야기해 주세요. 답변을 원문 근거와 금융 변수로 정리해 상담 담당자가 검토할 수 있는 자료로 만듭니다.</p><div className={styles.actions}><Link href="/judge-demo">사례로 시작하기 <ArrowRight size={18} /></Link><Link href="/about">서비스 소개</Link></div><div className={styles.pipeline}><span>사업 이야기</span><ArrowRight size={15} /><span>변수와 근거</span><ArrowRight size={15} /><span>금융기관 상담</span></div></div><article className={styles.gapCard}><p className={styles.eyebrow}>금융정보만으로 설명하기 어려운 사정</p><h2>신용정보에서 확인하는 것</h2><ul>{["연체", "대출", "카드", "거래"].map((item) => <li key={item}>{item}</li>)}</ul><hr /><h2>상담에서 더 살펴볼 것</h2><ul>{["매출 회복 이유", "반복고객 변화", "신규 예약·수주", "비용 조정 계획", "실행 시작일", "준비된 증빙"].map((item) => <li key={item}>{item}</li>)}</ul><p className={styles.small}>확인되지 않은 내용은 추정하지 않고 남겨 둡니다.</p></article></section>
    <p className={styles.scope}>동행금융은 대출 승인·거절 또는 신용등급을 산정하지 않습니다. 사업자가 설명한 추가 정보를 정리해 금융기관의 검토를 돕습니다.</p>
    <section className={styles.process}><h2>사업 설명부터 금융기관 상담까지</h2><ol>{[["인터뷰", "매출·운영 상황과 계획 설명"], ["정보 확인", "정리된 내용과 원문 대조"], ["변수·근거 검토", "계산 결과와 부족한 정보 확인"], ["개선 계획 선택", "사업자가 다음 행동 결정"], ["실행 기록", "준비자료와 진행 내용 기록"], ["금융기관 상담", "준비서를 챙겨 공식 창구로 이동"]].map(([title, body], index) => <li key={title}><span>0{index + 1}</span><strong>{title}</strong><p>{body}</p></li>)}</ol></section>
    <section className={styles.handoff}><h2>사업 현황과 근거를 금융기관 검토자료로</h2><p>사업 현황, 변수별 근거, 선택한 개선 계획과 실행 기록을 한 준비서에 담습니다. 부족한 자료를 확인하고 상담할 기관의 공식 안내로 이어갈 수 있습니다.</p><div className={styles.actions}><Link href="/demo/admin">금융기관 검토자료 만들기 <ArrowRight size={17} /></Link><Link href="/review">내 인터뷰 결과 선택</Link><Link href="/about#consultation">상담 경로 살펴보기</Link></div><p className={styles.small}>준비서는 직접 내려받아 이용합니다. 제휴 기관 접수나 자동 전송 기능은 제공하지 않습니다.</p></section>
    <DataComparison /><EngineArchitecture />
    <nav className={styles.secondaryLinks} aria-label="추가 체험"><Link href="/borrower?entry=sample">음성·텍스트 인터뷰</Link><Link href="/review">결과와 상담 준비</Link><Link href="/modeling?case=case_operating_drop&tab=impact">거래자료를 더한 변수 분석</Link></nav>
    <footer className={styles.small}><p>Competition Demo / Synthetic Data · 합성 사례로 운영하는 공모전 시연입니다. 실제 고객정보·실명·계좌번호를 입력하지 마세요.</p><p>공개 체험은 9월 12일 0시까지 제공됩니다. 작성한 기록은 현재 브라우저에서 다시 확인할 수 있습니다.</p></footer>
  </main>;
}
