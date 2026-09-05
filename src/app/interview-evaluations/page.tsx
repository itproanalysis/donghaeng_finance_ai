import type { Metadata } from "next";

import { EvaluationList } from "@/components/evaluation-list";

export const metadata: Metadata = {
  title: "완료 기록",
};

export default function EvaluationIndexPage() {
  return <EvaluationList />;
}
