import type { Metadata } from "next";

import { BorrowerInterviewRoom } from "@/components/borrower-interview-room";

export const metadata: Metadata = { title: "사업 현황 입력" };

interface BorrowerInterviewPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ mode?: string; autoplay?: string; demo?: string }>;
}

export default async function BorrowerInterviewPage({ params, searchParams }: BorrowerInterviewPageProps) {
  const [{ id }, { mode, autoplay, demo }] = await Promise.all([params, searchParams]);
  const voiceMode = mode === "voice";
  return (
    <BorrowerInterviewRoom
      interviewId={id}
      initialMode={voiceMode ? "voice" : "chat"}
      demoAvailable={demo === "operating-day"}
      autoStartQuestionVoice={voiceMode && autoplay === "1"}
    />
  );
}
