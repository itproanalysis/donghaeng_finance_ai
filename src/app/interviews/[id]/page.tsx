import type { Metadata } from "next";

import { InterviewWorkspace } from "@/components/interview-workspace";

export const metadata: Metadata = {
  title: "AI인터뷰",
};

interface InterviewPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ presentation?: string }>;
}

export default async function InterviewPage({ params, searchParams }: InterviewPageProps) {
  const { id } = await params;
  const { presentation } = await searchParams;
  return (
    <InterviewWorkspace
      interviewId={id}
      initialPresentationMode={presentation === "1"}
    />
  );
}
