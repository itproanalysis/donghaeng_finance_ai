import type { Metadata } from "next";

import { InterviewWorkspace } from "@/components/interview-workspace";

export const metadata: Metadata = {
  title: "상담 기록 검토",
};

interface InterviewPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ presentation?: string }>;
}

export default async function InterviewPage({ params, searchParams }: InterviewPageProps) {
  const [{ id }, { presentation }] = await Promise.all([params, searchParams]);
  return (
    <InterviewWorkspace
      interviewId={id}
      initialPresentationMode={presentation === "1"}
    />
  );
}
