import type { Metadata } from "next";
import Link from "next/link";
import { DataComparison, EngineArchitecture } from "@/components/engine-introduction";
import styles from "@/app/data-engine.module.css";

export const metadata: Metadata = { title: "서비스 소개 · 한 페이지 요약" };
const flows = [
  ["1. AI Interview", "가상의 사업자가 매출 변화·반복 고객·계획을 음성이나 텍스트로 설명합니다.", "기존 금융정보에 없는 사업 맥락을 수집합니다. 모름·거절도 그대로 기록합니다."],
  ["2. Canonical · Evidence", "내 발화가 어떤 정보로 정리되었는지 확인하고, 잘못된 내용은 정정합니다.", "선택 revision과 원문 Evidence를 대조합니다. SELF_REPORTED와 증빙 확인을 구분합니다."],
  ["3. Feature Engineering", "확인된 값과 부족한 정보를 확인합니다. 알 수 없는 값은 추정하지 않습니다.", "feature_schema_v2의 100개 정의에서 값·산식·기간·누락 정책·출처를 검토합니다."],
  ["4. Signal · Human Review", "결과가 나온 이유와 정보의 제약을 확인합니다.", "개선가능성 Signal의 계산 입력을 확인합니다. 최종 금융 판단은 금융기관이 합니다."],
  ["5. Action · Recovery Mission", "개선 Action 하나를 직접 선택하거나 보류합니다. 준비자료·실행·다음 상담 기록을 남깁니다.", "선택과 새 Evidence를 확인하고 추가 확인 필요 / 검토 완료 상태를 기록합니다."],
  ["6. 향후 Re-assessment", "실행 전후의 자료를 모아 다음 금융상담을 준비합니다.", "새 Evidence는 향후 재평가 시 활용될 수 있습니다. 현재 자동 재심사나 기관 전송은 제공하지 않습니다."],
];
export default function AboutPage() {
  return <main id="main-content" className={styles.page}><p className={styles.eyebrow}>서비스 소개 · Competition Demo / Synthetic Data</p><h1>사업자의 이야기를<br />검증 가능한 데이터로 바꿉니다.</h1><p>동행금융AI는 소상공인의 비정형 사업 정보를 AI 인터뷰로 수집하고, 이를 근거 추적 가능한 금융 Feature로 변환하여 기존 금융정보의 공백을 보완하는 웹서비스입니다.</p><p className={styles.scope}>수집하기 어려웠던 사업 맥락을 금융기관이 검토할 수 있도록 만드는 <strong>Alternative Data Generation Engine</strong>입니다.</p>
    <h2>사용자와 운영자의 진행 흐름</h2><div className={styles.summaryFlow}><strong>진행 단계</strong><b>사용자 · 사업자</b><b>운영자 · 금융기관 검토 관점</b></div>{flows.map(([stage, user, operator]) => <div className={styles.summaryFlow} key={stage}><strong>{stage}</strong><p>{user}</p><p>{operator}</p></div>)}
    <section className={styles.process}><h2>현재 제공 범위</h2><p>실제 InterviewService, 음성·텍스트 대화, Canonical revision, Evidence 추적, LIVE·FINAL, 100개 Feature 사전, 6개 핵심 Signal, 사용자 Action 선택과 실행기록을 연결합니다. 대화는 Anthropic 오케스트레이션과 결정론적 fallback을 사용하고, 모든 Feature 계산은 기존 서버 파이프라인에서 수행합니다.</p><p>Feature 사전에 정의된 외부·신용·거래 원천은 현재 인터뷰에 연결되어 있지 않습니다. 해당 값은 MISSING입니다. 별도의 합성 거래자료 규칙 실험은 실제 금융기관 데이터나 학습된 신용모델을 의미하지 않습니다.</p></section><DataComparison /><EngineArchitecture open />
    <p className={styles.scope}>동행금융AI는 대출 승인·거절 또는 신용등급을 생성하지 않습니다. 인터뷰에서 확보한 추가 정보를 구조화하여 사람이 검토할 수 있게 합니다.</p><p className={styles.small}>공개 환경은 공모전용 합성 데이터 데모입니다. 실제 고객정보를 입력하지 마세요. 실행기록도 자기보고로 저장되며 실제 증빙 확인이나 사업 성과 검증을 대신하지 않습니다.</p><nav className={styles.actions}><Link href="/judge-demo">3분 기술 데모</Link><Link href="/review">금융기관 관점에서 보기</Link><Link href="/">첫 화면</Link></nav>
  </main>;
}
