"use client";

import { KeyRound, LoaderCircle, LogIn, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";

import { readApiEnvelope } from "@/components/api-adapter";

export function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      await readApiEnvelope(response);
      const requested = search.get("next");
      const next = requested?.startsWith("/") && !requested.startsWith("//")
        ? requested
        : "/";
      router.replace(next);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인하지 못했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="login-page">
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-card__icon"><KeyRound size={24} /></div>
        <p className="panel-kicker">OPERATOR SESSION</p>
        <h1 id="login-title">상담사 로그인</h1>
        <p className="login-card__description">
          인터뷰·근거·평가는 tenant가 분리된 상담사 세션에서만 조회할 수 있습니다.
        </p>
        <form onSubmit={submit}>
          <label htmlFor="login-email">이메일</label>
          <input
            id="login-email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
          <label htmlFor="login-password">비밀번호</label>
          <input
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button--primary button--large" type="submit" disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" size={18} /> : <LogIn size={18} />}
            {submitting ? "로그인 확인 중" : "로그인"}
          </button>
        </form>
        <div className="login-card__boundary">
          <ShieldCheck size={17} />
          <p>로컬 작업공간 인증은 이 컴퓨터에서만 사용합니다. 운영 환경에는 외부 IdP·MFA가 필요합니다.</p>
        </div>
      </section>
    </main>
  );
}
