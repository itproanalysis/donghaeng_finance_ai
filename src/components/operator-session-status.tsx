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

export function OperatorSessionStatus() {
  const pathname = usePathname();
  const [operator, setOperator] = useState<string | null>(null);
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
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
  }, [pathname]);

  if (needsLogin) {
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
