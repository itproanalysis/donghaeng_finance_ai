import type { Metadata } from "next";
import { Gowun_Batang, Noto_Sans_KR } from "next/font/google";
import "./globals.css";
import "./companion.css";

const sans = Noto_Sans_KR({
  variable: "--font-sans",
  subsets: ["latin"],
});

const display = Gowun_Batang({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "동행금융 | 다시 금융과 만나는 세 걸음",
  description: "AI 인터뷰로 개인사업자의 회복 맥락을 정리하고, 금융기관이 검토할 수 있는 더 분명한 파일을 만듭니다.",
  openGraph: {
    title: "동행금융 | 다시 금융과 만나는 세 걸음",
    description: "AI 인터뷰, 현실적인 준비, 더 분명한 금융 검토 파일.",
  },
  twitter: {
    card: "summary",
    title: "동행금융 | 다시 금융과 만나는 세 걸음",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body
        className={`${sans.variable} ${display.variable} antialiased`}
      >
        <template
          data-impeccable-contract
          dangerouslySetInnerHTML={{
            __html: `<!--
THESIS: 점수 밖의 사정을 듣고, 실행 가능한 세 걸음을 함께 걷는 금융 동행.
OWN-WORLD: 새벽빛이 드는 한국의 산책길을 1인칭으로 걷는 차분한 회복 여정.
STORY: AI 인터뷰 → 현금흐름 습관 → 상담 자료 준비 → 사람의 재검토.
FIRST VIEWPORT: 중앙 소실점의 길, 동행금융 이름, 첫 미션과 스크롤 유도.
FORM: grounded candidate 3 + seed 5fecb680; restrained editorial HUD over a tactile Three.js road.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
-->`,
          }}
        />
        {children}
      </body>
    </html>
  );
}
