import type { Metadata } from "next";
import { InstitutionConsultation } from "@/components/institution-consultation";
import styles from "@/app/data-engine.module.css";
export const metadata: Metadata = { title: "금융기관 상담 준비" };
export default async function ConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main id="main-content" className={styles.page}><InstitutionConsultation key={id} interviewId={id} /></main>;
}
