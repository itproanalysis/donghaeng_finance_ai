import type { Metadata } from "next";
import { Suspense } from "react";

import { LoginForm } from "@/components/login-form";

export const metadata: Metadata = { title: "상담사 로그인" };

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="login-page">로그인 화면을 준비하고 있습니다.</main>}>
      <LoginForm />
    </Suspense>
  );
}
