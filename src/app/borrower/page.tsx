import type { Metadata } from "next";

import { BorrowerInterviewStart } from "@/components/borrower-interview-start";
import { isPublicReviewMode } from "@/server/public-review";

export const metadata: Metadata = { title: "가게 현황 입력" };

export const dynamic = "force-dynamic";

export default async function BorrowerPage({ searchParams }: { searchParams: Promise<{ entry?: string; scenario?: string; demoSet?: string }> }) {
  const publicReview = isPublicReviewMode();
  const query = await searchParams;
  const scenarioEntry = query.scenario === "operating-day";
  const demoSet = query.demoSet === "control" ? "control" : "primary";
  const sampleEntry = publicReview && query.entry === "sample" && !scenarioEntry;
  return <BorrowerInterviewStart key={scenarioEntry ? `scenario-${demoSet}` : sampleEntry ? "sample" : "own"} publicReview={publicReview} sampleEntry={sampleEntry} scenarioEntry={scenarioEntry} demoSet={demoSet} />;
}
