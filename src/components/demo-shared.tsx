import { ArrowRight, Check, Compass, Store } from "lucide-react";
import Link from "next/link";
import { DEMO_QUESTIONS } from "@/domain/service-demo";

export function DemoNotice({ other }: { other: "borrower" | "admin" }) {
  return (
    <div className="demo-notice">
      <span>
        <Compass size={16} />
        <strong>서비스 체험</strong> 가상 사례 · 이 탭에서만 진행 상태 유지
      </span>
      <Link href={`/demo/${other}`}>
        {other === "admin" ? "관리자 시점으로" : "사장님 시점으로"}{" "}
        <ArrowRight size={15} />
      </Link>
    </div>
  );
}

export function BusinessMap({ answers }: { answers: readonly number[] }) {
  return (
    <section className="business-map">
      <header>
        <div>
          <span className="dh-eyebrow">OUR BUSINESS MAP</span>
          <h2>대화로 채우는 사업 지도</h2>
        </div>
        <span>{answers.length} / 6</span>
      </header>
      <div className="business-map__center">
        <Store size={28} />
        <div>
          <strong>동행카페</strong>
          <span>가상의 소상공인 사업체</span>
        </div>
      </div>
      <div className="business-map__grid">
        {DEMO_QUESTIONS.map((question, i) => {
          const answer = question.options[answers[i]!];
          return (
            <article key={question.label} data-filled={!!answer}>
              <span>
                {answer ? <Check size={15} /> : `0${i + 1}`} {question.label}
              </span>
              <strong>{answer?.short ?? "이야기를 기다리고 있어요"}</strong>
              <small>
                {answer ? `출처: 예시 답변 ${i + 1}` : "아직 확인하지 않았어요"}
              </small>
            </article>
          );
        })}
      </div>
      <p>선택한 답변만 채워집니다. 빈칸을 0이나 추정값으로 바꾸지 않습니다.</p>
    </section>
  );
}
