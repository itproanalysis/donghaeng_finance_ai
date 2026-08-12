import type { Metadata } from "next";

import { BorrowerInterviewStart } from "@/components/borrower-interview-start";

export const metadata: Metadata = { title: "사장님 인터뷰" };

export default function BorrowerPage() {
  return <BorrowerInterviewStart />;
}
