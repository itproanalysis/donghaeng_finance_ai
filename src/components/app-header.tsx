"use client";

import {
  ChevronLeft,
  ClipboardCheck,
  GitBranch,
  LayoutDashboard,
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
    href: "/modeling",
    label: "사업·행동 평가",
    icon: GitBranch,
    isActive: (pathname) => pathname.startsWith("/modeling"),
  },
  {
    href: "/interviews",
    label: "상담 대장",
    icon: LayoutDashboard,
    isActive: (pathname) => pathname.startsWith("/interviews"),
  },
  {
    href: "/interview-evaluations",
    label: "완료 기록",
    icon: ClipboardCheck,
    isActive: (pathname) => pathname.startsWith("/interview-evaluations"),
  },
];

export function AppHeader({ publicReview = false }: { publicReview?: boolean } = {}) {
  const pathname = usePathname();
  const isBorrower = pathname.startsWith("/borrower");
  const isIntroduction = pathname === "/about";

  if (pathname === "/login" || pathname.startsWith("/demo")) {
    return null;
  }

  if (pathname === "/" || isBorrower || isIntroduction) {
    return (
      <header className={`app-header app-header--simple ${isBorrower || isIntroduction ? "app-header--borrower" : "app-header--entrance"}`}>
        <div className="app-header__inner">
          <Link className="brand" href="/" aria-label="동행금융 홈">
            <span className="brand__mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="brand__name">동행금융</span>
          </Link>
          <nav className="dh-header-nav" aria-label="주요 화면 이동">
            <Link href="/about" aria-current={isIntroduction ? "page" : undefined}>서비스 소개</Link>
            <Link href="/modeling?case=case_operating_drop&tab=impact">사업·행동 평가</Link>
            <Link href="/borrower?entry=sample" aria-current={isBorrower ? "page" : undefined}>현황 입력</Link>
            <Link href="/interviews">상담 대장</Link>
          </nav>
          {(isBorrower || isIntroduction) && (
            <Link className="app-header__admin-link" href="/">
              <ChevronLeft size={16} aria-hidden="true" />
              {publicReview ? "홈으로" : "골목 입구로"}
            </Link>
          )}
        </div>
      </header>
    );
  }


  return (
    <header className="app-header app-header--operator">
      <div className="app-header__inner">
        <Link className="brand" href="/" aria-label="동행금융 홈">
          <span className="brand__mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="brand__name">동행금융</span>
          <span className="app-header__path-label">골목 상담소</span>
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
                <Icon size={16} strokeWidth={2} aria-hidden="true" />
                {item.label}
              </Link>
            ) : null;
          })}
        </nav>

        <OperatorSessionStatus publicReview={publicReview} />
      </div>
    </header>
  );
}
