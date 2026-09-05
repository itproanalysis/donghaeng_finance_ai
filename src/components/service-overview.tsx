import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { AlleyEntranceScene } from "@/components/alley-entrance-scene";
import { isPublicReviewMode } from "@/server/public-review";
import { ServiceHome } from "@/components/service-home";

export function ServiceOverview() {
  const publicReview = isPublicReviewMode();
  if (publicReview) return <ServiceHome />;
  return (
    <main id="main-content" className="service-entrance">
      <section className="entrance-scene" aria-labelledby="entrance-heading">
        <AlleyEntranceScene />
        <div className="entrance-scene__veil" aria-hidden="true" />
        <div className="entrance-scene__copy">
          <span className="entrance-sign">{publicReview ? "가입·Google 로그인 없이 이용" : "골목 상담소"}</span>
          <h1 id="entrance-heading">사장님,<br />어서 오세요.</h1>
          <p>가게의 숫자와 사정을 함께 살펴보고,<br />현재 상황과 개선가능성을 근거와 함께 정리합니다.</p>
          <Link className="entrance-introduction" href="/about">서비스 소개 <ArrowRight size={17} aria-hidden="true" /></Link>
        </div>
        <nav className="entrance-paths" aria-label="이용할 화면 선택">
          <Link className="entrance-path entrance-path--owner" href={publicReview ? "/modeling?case=case_operating_drop&tab=impact" : "/borrower"}>
            <small>{publicReview ? "입력 없이 · 변수에서 평가항목까지" : "사장님 · 채팅 또는 음성 인터뷰"}</small>
            <span>{publicReview ? "모델링 결과 살펴보기" : "내 가게 이야기하기"} <ArrowRight size={21} aria-hidden="true" /></span>
          </Link>
          <Link className="entrance-path entrance-path--operator" href={publicReview ? "/borrower?entry=sample" : "/interviews"}>
            <small>{publicReview ? "가상 카페 · 직접 답변하고 기록 확인" : "담당자 · 기록 확인과 상담 준비"}</small>
            <span>{publicReview ? "가입 없이 바로 체험" : "상담 기록 살펴보기"} <ArrowRight size={21} aria-hidden="true" /></span>
          </Link>
        </nav>
        <p className="entrance-footnote">소상공인 금융 상담·평가 보조 서비스입니다. 대출 심사·승인을 대신하지 않습니다.</p>
      </section>
      {publicReview ? (
        <section className="review-guide" aria-labelledby="review-guide-title">
          <div><span className="dh-eyebrow">웹사이트 심사 안내</span><h2 id="review-guide-title">변수가 평가에 반영되는 과정부터.</h2>
          <p>같은 금융데이터에서 맥락 변수를 결합하기 전·후의 결과를 비교하세요. 두 축 점수의 산식, 10개 평가항목의 배점, 변수별 근거를 로그인 없이 확인합니다.</p></div>
          <div className="review-guide__actions">
          <Link className="button button--primary" href="/modeling?case=case_operating_drop&tab=impact">변수와 평가 반영 보기 <ArrowRight size={16} /></Link>
          <Link className="button button--secondary" href="/borrower">직접 인터뷰하기 <ArrowRight size={16} /></Link>
          <Link className="button button--secondary" href="/interviews">이 브라우저의 상담 기록 <ArrowRight size={16} /></Link>
          <p>모델링은 합성 사례 10개로 94개 변수와 규칙 기반 평가를 검증합니다. 직접 인터뷰에서는 실제 AI 대화와 원문·정리값·상담 메모를 별도로 체험합니다.</p>
          <p>기록은 이 브라우저에만 연결됩니다. 다른 방문자의 기록과 운영 자료는 보이지 않습니다. 실명·계좌번호 등 민감한 정보는 입력하지 마세요.</p>
          <details><summary>운영 기간과 이용 범위</summary><p>공개 접속은 9월 12일 0시(한국 시간)까지 제공됩니다. 브라우저 쿠키를 지우면 기존 기록에 다시 접근할 수 없습니다. 실시간 통화는 한 번에 10분, 방문자당 하루 2회이며 전체 이용량에 따라 일시 제한될 수 있습니다. 채팅으로 이어갈 수 있습니다. 심사용 기록은 별도 서버에 보관되며 운영 자료로 합쳐지지 않습니다.</p></details></div>
        </section>
      ) : null}
      <section className="entrance-purpose" aria-labelledby="entrance-purpose-heading">
        <div>
          <span className="dh-eyebrow">금융데이터에서 설명 가능한 평가까지</span>
          <h2 id="entrance-purpose-heading">숫자만으로 설명하기 어려웠던<br />가게 사정까지 함께 담습니다.</h2>
          <p>숫자로 확인한 변화에 사업 현황과 계획을 더합니다. 정형 데이터와 맥락을 변수로 연결하고, 현재 상황과 개선가능성을 구분해 검토합니다.</p>
        </div>
        <ol>
          <li><strong>01 · 데이터와 맥락을 변수로</strong><span>출처와 상태를 구분하고, 필요한 사정과 계획을 값으로 정리합니다.</span></li>
          <li><strong>02 · 두 축 결과 산출</strong><span>현재 상황과 개선가능성의 배점·산식·제외 항목을 함께 확인합니다.</span></li>
          <li><strong>03 · 평가 반영과 재검토</strong><span>변수에서 평가항목까지 근거를 추적하고, 새 자료로 같은 기준을 다시 적용합니다.</span></li>
        </ol>
        <p className="dh-footnote">합성 데이터 모델링과 실제 인터뷰·상담 자료 정리를 제공합니다. 두 경로의 자동 결합과 은행 데이터 연동은 다음 단계입니다.</p>
      </section>
    </main>
  );
}
