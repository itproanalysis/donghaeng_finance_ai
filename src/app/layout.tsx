import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "동행금융AI",
    template: "%s | 동행금융AI",
  },
  description:
    "사업자금 상담 인터뷰의 사실 수집과 보조지표 생성을 돕는 금융 업무 도구",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main-content">
          본문으로 바로가기
        </a>
        <AppHeader />
        {children}
      </body>
    </html>
  );
}
