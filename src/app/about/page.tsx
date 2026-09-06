import type { Metadata } from "next";
import Link from "next/link";
import { DataComparison, EngineArchitecture } from "@/components/engine-introduction";
import { INSTITUTION_DIRECTORY } from "@/domain/consultation-institutions";
import styles from "@/app/data-engine.module.css";
export const metadata: Metadata = { title: "서비스 소개" };
const flows = [
  ["1. 사업 이야기", "매출이 달라진 이유, 운영 상황과 계획을 말하거나 입력합니다.", "정형 금융정보에 없는 사업 맥락을 수집합니다."],
  ["2. 정보 확인", "답변이 어떻게 정리되었는지 확인하고 잘못된 내용은 정정합니다.", "선택된 정보와 원문 근거를 대조합니다."],
  ["3. 변수와 근거", "계산된 값과 아직 부족한 정보를 확인합니다.", "100개 변수의 값·산식·기간·출처·누락 상태를 살펴봅니다."],
  ["4. 개선 계획", "앞으로 할 일을 직접 선택하거나 보류합니다.", "계획의 입력 근거와 실행 제약을 검토합니다."],
  ["5. 실행 기록", "준비한 자료와 실행 내용을 남깁니다.", "새 기록을 기존 인터뷰 결과와 구분해 확인합니다."],
  ["6. 금융기관 상담", "상담 준비서를 내려받고 선택한 기관의 공식 창구에서 상담을 진행합니다.", "현황·변수·근거·계획·기록과 부족한 자료를 한 준비서에서 확인합니다."],
  ["7. 다음 검토", "추가로 요청받은 자료와 실행 전후의 기록을 준비합니다.", "새로운 근거를 향후 재평가에 활용할 수 있습니다. 현재 자동 재평가는 제공하지 않습니다."],
];
export default function AboutPage() {
  return <main id="main-content" className={styles.page}><p className={styles.eyebrow}>서비스 소개</p><h1>사업의 사정을 정리해<br />금융상담에 가져갑니다.</h1><p>동행금융은 매출 변화와 운영 계획처럼 숫자만으로 설명하기 어려운 사업 정보를 수집합니다. 답변을 원문 근거와 연결된 변수로 바꾸고, 금융기관 상담에 필요한 자료로 정리합니다.</p>
    <h2>사용자와 담당자의 진행 흐름</h2><div className={styles.summaryFlow}><strong>진행 단계</strong><b>사업자</b><b>상담 담당자</b></div>{flows.map(([stage, user, operator]) => <div className={styles.summaryFlow} key={stage}><strong>{stage}</strong><p>{user}</p><p>{operator}</p></div>)}
    <section id="consultation" className={styles.handoff}><h2>금융기관으로 이어지는 방법</h2><p>분석 결과나 실행 기록에서 ‘금융기관 상담 준비’를 선택합니다. 상담할 기관과 준비자료를 저장한 뒤, 원문·변수·계획·실행 기록이 담긴 준비서를 내려받습니다. 공식 안내에서 상담 절차를 확인하고 필요한 원본 자료를 함께 준비하세요.</p><div className={styles.institutionCards}>{INSTITUTION_DIRECTORY.map((item) => <article key={item.id}><small>{item.category}</small><h3>{item.name}</h3><p>{item.description}</p><a href={item.url} target="_blank" rel="noopener noreferrer">공식 상담 안내</a></article>)}</div><p className={styles.small}>위 목록은 공식 안내 경로입니다. 제휴·상품 추천·접수 완료를 뜻하지 않으며 자료가 기관으로 자동 전송되지 않습니다. 거래 은행 상담에도 준비서를 사용할 수 있습니다.</p><nav className={styles.actions}><Link href="/demo/admin">금융기관 검토자료 만들기</Link><Link href="/review">내 인터뷰 결과 선택</Link></nav></section>
    <DataComparison /><EngineArchitecture />
    <details className={styles.architecture}><summary>기술과 제공 범위</summary><p>AI 인터뷰는 질문과 응답을 담당합니다. 서버는 원문 근거, Canonical revision, LIVE·FINAL 기록과 feature_schema_v2의 변수 변환을 처리합니다. 이 구조는 기존 금융정보의 공백을 보완하는 Alternative Data Generation Engine입니다.</p><p>외부·신용·거래 원천이 연결되지 않은 변수는 MISSING으로 표시합니다. 별도 거래자료 분석은 합성 데이터를 사용한 규칙 실험이며, 검증된 신용예측 모델은 아닙니다.</p></details>
    <p className={styles.scope}>동행금융은 대출 승인·거절 또는 신용등급을 산정하지 않습니다. 최종 금융 판단은 해당 금융기관이 합니다.</p><p className={styles.small}>Competition Demo / Synthetic Data · 합성 사례로 운영하는 시연입니다. 실제 고객정보를 입력하지 마세요. 실행 기록은 자기보고 자료이며 원본 증빙 확인을 대신하지 않습니다.</p><nav className={styles.actions}><Link href="/judge-demo">사례로 시작하기</Link><Link href="/review">결과와 상담 준비</Link><Link href="/">첫 화면</Link></nav>
  </main>;
}
