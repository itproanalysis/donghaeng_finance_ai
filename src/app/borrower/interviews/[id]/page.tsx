import type { Metadata } from "next";

import { BorrowerInterviewRoom } from "@/components/borrower-interview-room";

export const metadata: Metadata = { title: "사장님 인터뷰 진행" };

interface BorrowerInterviewPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; autoplay?: string }>;
}

export default async function BorrowerInterviewPage({ params, searchParams }: BorrowerInterviewPageProps) {
  const [{ id }, { mode, autoplay }] = await Promise.all([params, searchParams]);
  const voiceMode = mode === "voice";
  return <BorrowerInterviewRoom interviewId={id} initialMode={voiceMode ? "voice" : "chat"} autoStartQuestionVoice={voiceMode && autoplay === "1"} />;
}
