import type { Metadata } from "next";
import { DataReviewOperator } from "@/components/data-review-operator";
import styles from "@/app/data-engine.module.css";
export const metadata: Metadata = { title: "사업 정보 · 원문과 Feature 검토" };
export default async function ReviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main id="main-content" className={styles.page}><DataReviewOperator key={id} interviewId={id} /></main>;
}
