import { Check } from "lucide-react";

export const BORROWER_JOURNEY = [
  "가게 소개",
  "인터뷰",
  "내 답변 확인",
  "상담 준비",
];

export const ADMIN_JOURNEY = [
  "가게 현황 분석",
  "개선 과제 제안",
  "실행 근거 확인",
  "기관 상담 준비",
];

export function JourneyNav({
  steps,
  current,
  label,
}: {
  steps: readonly string[];
  current: number;
  label: string;
}) {
  return (
    <nav className="journey-nav" aria-label={label}>
      <ol>
        {steps.map((step, index) => {
          const state =
            index < current ? "done" : index === current ? "current" : "next";
          return (
            <li
              key={step}
              data-state={state}
              aria-current={index === current ? "step" : undefined}
            >
              <span aria-hidden="true">
                {index < current ? <Check size={14} strokeWidth={2.5} /> : `0${index + 1}`}
              </span>
              <strong>
                {step}
                {index < current && (
                  <span className="sr-only"> (완료)</span>
                )}
              </strong>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
