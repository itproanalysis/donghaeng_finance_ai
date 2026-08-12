"use client";

import {
  ClipboardCheck,
  HandCoins,
  LayoutDashboard,
  ListChecks,
  MessageSquareText,
  RefreshCcw,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { OperatorSessionStatus } from "@/components/operator-session-status";

interface NavigationItem {
  href: string | null;
  label: string;
  icon: LucideIcon;
  isActive: (pathname: string) => boolean;
}

const navItems: NavigationItem[] = [
  {
    href: "/",
    label: "대시보드",
    icon: LayoutDashboard,
    isActive: (pathname) => pathname === "/",
  },
  {
    href: "/interviews",
    label: "AI 인터뷰",
    icon: MessageSquareText,
    isActive: (pathname) => pathname.startsWith("/interviews"),
  },
  {
    href: "/interview-evaluations",
    label: "인터뷰 평가",
    icon: ClipboardCheck,
    isActive: (pathname) => pathname.startsWith("/interview-evaluations"),
  },
  {
    href: null,
    label: "목표 수행",
    icon: ListChecks,
    isActive: () => false,
  },
  {
    href: null,
    label: "재평가",
    icon: RefreshCcw,
    isActive: () => false,
  },
  {
    href: null,
    label: "대출 중개",
    icon: HandCoins,
    isActive: () => false,
  },
];

export function AppHeader() {
  const pathname = usePathname();
  const simplified = pathname === "/" || pathname.startsWith("/borrower");

  if (simplified) {
    const borrower = pathname.startsWith("/borrower");
    return (
      <header className="app-header app-header--simple">
        <div className="app-header__inner">
          <Link className="brand" href="/" aria-label="동행금융AI 화면 선택">
            <span className="brand__mark" aria-hidden="true"><span /><span /><span /></span>
            <span className="brand__name">동행금융AI</span>
          </Link>
          <div className="app-header__simple-title">{borrower ? "사장님 인터뷰" : "화면 선택"}</div>
          {borrower && <Link className="app-header__admin-link" href="/interviews">관리자 화면</Link>}
        </div>
      </header>
    );
  }

  return (
    <header className="app-header">
      <div className="app-header__inner">
        <Link className="brand" href="/" aria-label="동행금융AI 홈">
          <span className="brand__mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand__name">동행금융AI</span>
          <span className="brand__slogan" style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginLeft: "0.75rem", display: "none" }}>
            사장님의 계획을 인터뷰로 정리하는 AI 자립지원 서비스
          </span>
        </Link>

        <nav className="primary-nav" aria-label="주요 메뉴">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.isActive(pathname);

            return item.href ? (
              <Link
                className="primary-nav__link"
                data-active={active ? "true" : undefined}
                href={item.href}
                key={item.href}
                aria-current={active ? "page" : undefined}
              >
                <Icon size={17} strokeWidth={2} aria-hidden="true" />
                {item.label}
              </Link>
            ) : (
              <span
                className="primary-nav__link primary-nav__link--disabled"
                aria-disabled="true"
                title="후속 서비스 영역 · 준비 중"
                key={item.label}
              >
                <Icon size={17} strokeWidth={2} aria-hidden="true" />
                {item.label}
                <small>준비 중</small>
              </span>
            );
          })}
        </nav>

        <OperatorSessionStatus />
      </div>
    </header>
  );
}
