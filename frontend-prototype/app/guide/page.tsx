import Link from "next/link";
import { ServiceHeader } from "../components/ServiceNavigation";

export default function GuidePage() {
  return (
    <>
      <ServiceHeader />
      <main className="companion-page guide-page">
        <div className="companion-kicker">동행금융 · 서비스 한눈에</div>
        <section className="guide-intro">
          <div>
            <h1>
              한 사람의 이야기,
              <br />두 방향의 동행.
            </h1>
            <p>
              골목에서 시작한 이야기가 인터뷰의 근거가 되고,
              <br />
              관리자의 개선 제안과 다음 금융 상담으로 이어집니다.
            </p>
            <Link className="companion-button" href="/">
              사장님과 함께 걷기 <span>↗</span>
            </Link>
          </div>
          <img
            src="/morning-cafe-recovered.png"
            alt="불을 밝히고 다시 손님을 맞을 준비를 하는 카페"
          />
        </section>
        <section className="guide-flow">
          <header>
            <span>01</span>
            <div>
              <small>사장님의 시선</small>
              <h2>이야기하고, 내 결과를 확인합니다.</h2>
            </div>
            <Link href="/demo">인터뷰 바로가기 →</Link>
          </header>
          <ol>
            {[
              {
                title: "함께 걷기",
                text: "골목에서 상황·지출·준비자료를 생각합니다.",
              },
              {
                title: "사장님 인터뷰",
                text: "유진의 질문을 듣고, 직접 답변을 남깁니다.",
              },
              {
                title: "결과 확인",
                text: "선택한 내용과 답변이 어떻게 정리됐는지 확인합니다.",
              },
              {
                title: "다음 동행",
                text: "개선 후보와 다음 상담에서 준비할 자료를 살펴봅니다.",
              },
            ].map((s) => (
              <li key={s.title}>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
        <div className="guide-connection">
          ↓ 같은 인터뷰 기록으로 연결 · 다른 기기는 결과에서 기록 내려받기 →
          관리자에서 가져오기
        </div>
        <section className="guide-flow guide-flow--admin">
          <header>
            <span>02</span>
            <div>
              <small>관리자의 시선</small>
              <h2>근거를 읽고, 다음 행동을 준비합니다.</h2>
            </div>
            <Link href="/admin">관리자 화면 열기 →</Link>
          </header>
          <ol>
            {[
              {
                title: "사장님 현황",
                text: "작성된 인터뷰와 검토 상태를 모아 봅니다.",
              },
              {
                title: "근거 분석",
                text: "사업 상황·변화·준비자료를 원래 답변과 함께 검토합니다.",
              },
              {
                title: "개선안 검토",
                text: "실행 후보와 담당자·점검일을 정리합니다.",
              },
              {
                title: "금융기관 연결",
                text: "공식 상담채널을 확인하고 준비자료를 내려받습니다.",
              },
            ].map((s) => (
              <li key={s.title}>
                <strong>{s.title}</strong>
                <p>{s.text}</p>
              </li>
            ))}
          </ol>
        </section>
        <section className="guide-review">
          <div>
            <span className="companion-kicker">처음 살펴보신다면</span>
            <h2>이 순서로 확인해 보세요.</h2>
          </div>
          <ol>
            <li>
              <Link href="/">골목의 세 가지 질문으로 ‘동행’을 경험하기 →</Link>
            </li>
            <li>
              <Link href="/demo">인터뷰 답변을 남기고 결과 확인하기 →</Link>
            </li>
            <li>
              <Link href="/admin">
                같은 기록으로 개선·금융 상담 준비 살펴보기 →
              </Link>
            </li>
          </ol>
        </section>
        <p className="companion-note">
          이 체험의 답변과 검토 초안은 이 브라우저에 저장됩니다. 다른 기기로는
          인터뷰 기록 파일을 직접 전달할 수 있습니다. 실제 신용평가·대출
          신청·금융기관 전송을 수행하지 않으며, 최종 대출 판단은 금융기관이
          합니다.
        </p>
      </main>
    </>
  );
}
