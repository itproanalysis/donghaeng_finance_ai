"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useState } from "react";

import { readApiEnvelope } from "@/components/api-adapter";
import { safeLoginReturnPath } from "@/domain/login-return-path";

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
      router.replace(safeLoginReturnPath(search.get("next")));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "로그인하지 못했습니다.");
      setSubmitting(false);
    }
  }

  return (
    <main id="main-content" className="login-page">
      <header className="login-page-nav">
        <Link href="/" className="login-page-brand">
          <span className="login-brand-badge">동</span> 동행금융
        </Link>
        <Link href="/" className="login-page-back">← 동행길 안내로 돌아가기</Link>
      </header>

      <div className="login-signboard-wrapper">
        <section className="login-card" aria-labelledby="login-title">
          <div className="login-stamp-seal" aria-hidden="true">
            <span>同行<br />相談</span>
            <small>동행상담</small>
          </div>

          <div className="login-card-header">
            <span className="login-sub-callout">同行金融 · 골목길 관리자 상담소</span>
            <h1 id="login-title">상담사 출입명부</h1>
            <p className="login-card__description">
              사장님 인터뷰의 진행 상태와 확인 근거, 상담 준비자료를 검토하는
              담당자 전용 공간입니다.
            </p>
          </div>

          <form onSubmit={submit} className="login-form-body">
            <div className="login-field-group">
              <label htmlFor="login-email">담당 심사역 계정 (이메일)</label>
              <input
                id="login-email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="counselor@donghaeng.local"
                required
              />
            </div>

            <div className="login-field-group">
              <label htmlFor="login-password">출입 비밀번호</label>
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                required
              />
            </div>

            {error && <p className="form-error" role="alert">{error}</p>}

            <button className="login-enter-button" type="submit" disabled={submitting}>
              {submitting ? "명부 확인 중..." : "상담소 문 열고 입장하기"}
            </button>
          </form>

          <p className="login-account-help">계정이 필요한 경우 담당 기관 관리자에게 문의해 주세요.</p>

          <div className="login-card-footer-note">
            <p>
              ※ 인터뷰 결과는 상담 보조정보이며 대출 승인·거절이나 신용등급을 자동으로 결정하지 않습니다.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
