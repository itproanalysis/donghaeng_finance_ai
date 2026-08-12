import type { Metadata } from "next";

import { EvaluationReport } from "@/components/evaluation-report";

export const metadata: Metadata = {
  title: "인터뷰 평가",
};

interface EvaluationPageProps {
  params: Promise<{ id: string }>;
}

export default async function EvaluationPage({ params }: EvaluationPageProps) {
  const { id } = await params;
  return <EvaluationReport evaluationId={id} />;
}
