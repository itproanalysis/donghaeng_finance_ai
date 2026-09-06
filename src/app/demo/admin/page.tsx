import type { Metadata } from "next";
import { AdminDemo } from "@/components/admin-demo";
import { InstitutionConsultation } from "@/components/institution-consultation";
import { DEFAULT_MODELING_CASE_ID, getModelingBundle, getModelingCase, isModelingCaseId } from "@/server/modeling-demo";
import styles from "@/app/institution-review.module.css";

export const metadata: Metadata = { title: "금융기관 검토자료", description: "사업 현황, 변수별 평가 근거, 수행자료와 담당자 의견을 정리하는 검토서입니다." };
export default async function Page({ searchParams }: { searchParams: Promise<{ case?: string; interview?: string }> }) {
  const query = await searchParams;
  if (query.interview) return <main id="main-content" className={styles.page}><InstitutionConsultation key={query.interview} interviewId={query.interview} reviewFirst /></main>;
  const selectedCase = getModelingCase(query.case && isModelingCaseId(query.case) ? query.case : DEFAULT_MODELING_CASE_ID)!;
  const bundle = getModelingBundle();
  return <AdminDemo selectedCase={selectedCase} cases={bundle.cases} reevaluation={bundle.reevaluation} modelVersion={bundle.model.version} />;
}
