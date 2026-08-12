import type { Metadata } from "next";

import { EvaluationList } from "@/components/evaluation-list";

export const metadata: Metadata = {
  title: "인터뷰 평가",
};

export default function EvaluationIndexPage() {
  return <EvaluationList />;
}
