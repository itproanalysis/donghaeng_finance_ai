import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Gowun_Batang, Noto_Sans_KR } from "next/font/google";

import { AppHeader } from "@/components/app-header";
import { isPublicReviewMode } from "@/server/public-review";

export const dynamic = "force-dynamic";

import "./globals.css";
import "./journey.css";
import "./service-experience.css";
import "./alley-atmosphere.css";
import "./service-polish.css";

const sans = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "700"],
});

const display = Gowun_Batang({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: {
    default: "동행금융 | 사업·행동 평가",
    template: "%s | 동행금융",
  },
  description:
    "금융자료와 사업 현황을 변수화하고, 목표 수행과 재평가 결과를 금융기관 검토 근거로 정리합니다.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko" data-auth-mode={isPublicReviewMode() ? "public-review" : undefined} data-scroll-behavior="smooth" className={`${sans.variable} ${display.variable}`}>
      <body className="antialiased">
        <a className="skip-link" href="#main-content">
          본문으로 바로가기
        </a>
        <AppHeader publicReview={isPublicReviewMode()} />
        {children}
      </body>
    </html>
  );
}
