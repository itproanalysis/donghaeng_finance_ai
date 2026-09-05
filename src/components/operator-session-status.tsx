"use client";

import { LogIn, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { authenticatedFetch, readApiEnvelope } from "@/components/api-adapter";

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function OperatorSessionStatus({ publicReview = false }: { publicReview?: boolean } = {}) {
  const pathname = usePathname();
  const [operator, setOperator] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    // The public evidence pages need neither a visitor cookie nor API quota.
    if (pathname === "/modeling" && publicReview) return;
    let active = true;
    void authenticatedFetch("/api/auth/me", { cache: "no-store" })
      .then(readApiEnvelope)
      .then((data) => {
        if (!active) return;
        const root = record(data);
        const principal = record(root?.principal) ?? root;
        const displayName = principal?.displayName;
        setOperator(
          typeof displayName === "string" && displayName.trim()
            ? displayName.trim()
            : "인증된 상담사",
        );
        setNeedsLogin(false);
      })
      .catch(() => {
        if (active) {
          setOperator(null);
          setNeedsLogin(true);
        }
      });
    return () => {
      active = false;
    };
  }, [pathname, publicReview]);

  if (pathname === "/modeling" && publicReview) return <span className="operator-session"><ShieldCheck size={14} aria-hidden="true" /> 로그인 없이 분석 열람</span>;

  if (needsLogin) {
    if (publicReview) return <span className="operator-session" role="status">연결 확인이 필요합니다 · 새로고침해 주세요</span>;
    return (
      <Link className="operator-session operator-session--login" href="/login">
        <LogIn size={14} /> 로그인
      </Link>
    );
  }

  return (
    <div className="operator-session" aria-label="상담사 세션 상태">
      <ShieldCheck size={14} aria-hidden="true" />
      <span>{operator ?? "세션 확인 중"}</span>
    </div>
  );
}
