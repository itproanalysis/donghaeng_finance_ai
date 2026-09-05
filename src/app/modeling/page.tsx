import type { Metadata } from "next";

import { ModelingReview } from "@/components/modeling-review";
import {
  DEFAULT_MODELING_CASE_ID,
  getModelingBundle,
  getModelingCase,
  isModelingCaseId,
} from "@/server/modeling-demo";

export const metadata: Metadata = {
  title: "사업·행동 평가",
  description: "금융자료와 사업 현황의 변수, 평가항목별 배점과 산출 근거를 확인합니다.",
};

interface ModelingPageProps {
  searchParams: Promise<{ case?: string | string[] }>;
}

export default async function ModelingPage({ searchParams }: ModelingPageProps) {
  const query = await searchParams;
  const requested = Array.isArray(query.case) ? query.case[0] : query.case;
  const caseId = requested && isModelingCaseId(requested) ? requested : DEFAULT_MODELING_CASE_ID;
  const selectedCase = getModelingCase(caseId);
  const bundle = getModelingBundle();

  if (!selectedCase) throw new Error("Default modeling case is missing");

  return (
    <ModelingReview
      selectedCase={selectedCase}
      caseOptions={bundle.cases.map((item) => ({
        caseId: item.caseId,
        ordinal: item.ordinal,
        title: item.title,
        verificationPurpose: item.verificationPurpose,
        currentSituation: item.scorecard.currentSituation.score,
        improvement: item.scorecard.improvement.score,
      }))}
      model={bundle.model}
      comparisons={bundle.comparisons}
      reevaluation={bundle.reevaluation}
      validation={bundle.validation}
      allCases={bundle.cases}
    />
  );
}
