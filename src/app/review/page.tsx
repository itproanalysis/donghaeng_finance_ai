import type { Metadata } from "next";
import Link from "next/link";
import { DataReviewList } from "@/components/data-review-operator";
import styles from "@/app/data-engine.module.css";
export const metadata: Metadata = { title: "결과와 상담 준비" };
export default function ReviewPage() {
  return <main id="main-content" className={styles.page}><p className={styles.eyebrow}>Competition Demo / Synthetic Data</p><h1>사업 정보와 상담 준비</h1><p>분석 결과와 부족한 자료를 확인하고 금융기관 상담을 준비합니다.</p><nav className={styles.secondaryLinks}><Link href="/judge-demo">사례로 인터뷰 시작</Link><Link href="/interviews">기존 상담 대장</Link></nav><DataReviewList /></main>;
}
