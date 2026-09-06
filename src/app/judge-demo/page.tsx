import type { Metadata } from "next";
import { JudgeDemo } from "@/components/judge-demo";
export const metadata: Metadata = { title: "3분 기술 데모 · 발화에서 Feature까지" };
export default async function JudgeDemoPage({ searchParams }: { searchParams: Promise<{ interview?: string }> }) {
  const { interview } = await searchParams;
  return <JudgeDemo key={interview ?? "new-demo"} initialInterviewId={interview} />;
}
