import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { isGoogleIapMode } from "@/server/iap-auth";
import { isPublicReviewMode } from "@/server/public-review";
import { safeLoginReturnPath } from "@/domain/login-return-path";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "상담사 로그인" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  // IAP already authenticated the entire request. Never show a password form
  // whose submission is deliberately disabled in the cloud deployment.
  if (isGoogleIapMode() || isPublicReviewMode()) redirect(safeLoginReturnPath((await searchParams).next));
  return (
    <Suspense fallback={<main className="login-page">로그인 화면을 준비하고 있습니다.</main>}>
      <LoginForm />
    </Suspense>
  );
}
