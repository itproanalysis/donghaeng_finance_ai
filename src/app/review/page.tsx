import type { Metadata } from "next";
import Link from "next/link";
import { DataReviewList } from "@/components/data-review-operator";
import styles from "@/app/data-engine.module.css";
export const metadata: Metadata = { title: "금융기관 관점 · 정보 검토 목록" };
export default function ReviewPage() {
  return <main id="main-content" className={styles.page}><p className={styles.eyebrow}>Competition Demo / Synthetic Data</p><h1>금융기관 관점에서 추가 정보를 검토합니다.</h1><p>Evidence와 Feature의 확보 범위, 누락, 사업자의 선택을 확인합니다. 이 화면은 공개 방문자 자신의 합성 기록만 표시합니다.</p><nav className={styles.secondaryLinks}><Link href="/judge-demo">합성 인터뷰 시작</Link><Link href="/interviews">기존 상담 대장</Link></nav><DataReviewList /></main>;
}
