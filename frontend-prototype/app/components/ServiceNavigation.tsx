"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function ServiceLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  const links = compact
    ? [
        { href: "/guide", label: "서비스 한눈에" },
        { href: "/admin", label: "관리자" },
        { href: "/demo", label: "인터뷰 바로가기" },
      ]
    : [
        { href: "/", label: "함께 걷기" },
        { href: "/demo", label: "사장님 인터뷰" },
        { href: "/results", label: "내 결과" },
        { href: "/admin", label: "관리자" },
        { href: "/guide", label: "서비스 한눈에" },
      ];
  return (
    <nav
      className={`service-links${compact ? " service-links--compact" : ""}`}
      aria-label="서비스 탐색"
    >
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={pathname === link.href ? "page" : undefined}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}

export function ServiceHeader() {
  return (
    <header className="companion-header">
      <Link className="companion-brand" href="/">
        동행금융<span>다시 문을 여는 길</span>
      </Link>
      <ServiceLinks />
    </header>
  );
}
export function FlowSteps({
  admin = false,
  active = 0,
}: {
  admin?: boolean;
  active?: number;
}) {
  const items = admin
    ? ["사장님 현황", "근거 분석", "개선안 검토", "금융기관 연결"]
    : ["함께 걷기", "사장님 인터뷰", "결과 확인", "다음 동행"];
  return (
    <ol
      className="companion-steps"
      aria-label={admin ? "관리자 진행 흐름" : "사장님 진행 흐름"}
    >
      {items.map((item, i) => (
        <li
          key={item}
          aria-current={i === active ? "step" : undefined}
          data-done={i < active}
        >
          <span>{i < active ? "✓" : `0${i + 1}`}</span>
          {item}
        </li>
      ))}
    </ol>
  );
}
