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
  { href: "/judge-demo", label: "사례 체험", icon: GitBranch, isActive: (pathname) => pathname.startsWith("/judge-demo") },
  { href: "/review", label: "데이터 검토", icon: ClipboardCheck, isActive: (pathname) => pathname.startsWith("/review") },
  {
    href: "/modeling",
    label: "규칙 산출 실험",
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
  const isEngine = pathname === "/demo/admin" || pathname === "/" || isIntroduction || pathname.startsWith("/judge-demo") || pathname.startsWith("/recovery") || pathname.startsWith("/review") || pathname.startsWith("/consultation");

  if (pathname === "/login" || (pathname.startsWith("/demo") && pathname !== "/demo/admin")) {
    return null;
  }

  if (isEngine || isBorrower) {
    return (
      <header className={`app-header app-header--simple ${isEngine ? "app-header--engine" : "app-header--borrower"}`}>
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
            <Link href="/judge-demo" aria-current={pathname.startsWith("/judge-demo") ? "page" : undefined}>사례 체험</Link>
            {isBorrower ? <Link href="/borrower?entry=sample" aria-current="page">인터뷰 시작</Link> : <Link href="/demo/admin" aria-current={pathname === "/demo/admin" ? "page" : undefined}>기관 검토자료</Link>}
            <Link href="/review" aria-current={pathname.startsWith("/review") ? "page" : undefined}>결과·상담 준비</Link>
          </nav>
          {(isBorrower || isIntroduction) && (
            <Link className="app-header__admin-link" href="/">
              <ChevronLeft size={16} aria-hidden="true" />
              홈으로
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
