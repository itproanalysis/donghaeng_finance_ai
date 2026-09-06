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
    default: "동행금융AI | 사업 이야기를 검증 가능한 데이터로",
    template: "%s | 동행금융",
  },
  description:
    "소상공인의 비정형 사업 정보를 AI 인터뷰로 수집하고, 근거 추적 가능한 금융 Feature로 변환해 기존 금융정보의 공백을 보완합니다.",
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
