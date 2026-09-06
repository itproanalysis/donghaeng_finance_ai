import type { Metadata } from "next";
import { JudgeDemo } from "@/components/judge-demo";
export const metadata: Metadata = { title: "사례 체험 · 사업 정보에서 금융상담까지" };
export default async function JudgeDemoPage({ searchParams }: { searchParams: Promise<{ interview?: string }> }) {
  const { interview } = await searchParams;
  return <JudgeDemo key={interview ?? "new-demo"} initialInterviewId={interview} />;
}
