import type { Metadata } from "next";
import Link from "next/link";
import { RecoveryJourney } from "@/components/recovery-journey";
import styles from "@/app/data-engine.module.css";
export const metadata: Metadata = { title: "개선 Action · Recovery Journey" };
export default async function RecoveryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main id="main-content" className={styles.page}><p className={styles.eyebrow}>Competition Demo / Synthetic Data</p><h1>분석 이후의 다음 한 걸음</h1><p>인터뷰에서 확인한 정보와 근거를 살펴본 뒤, 앞으로 할 일을 직접 선택합니다.</p><Link href={`/review/${id}`}>분석 결과·Feature·원문 다시 보기</Link><RecoveryJourney key={id} interviewId={id} /></main>;
}
