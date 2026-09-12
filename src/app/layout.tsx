import type { Metadata } from "next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { NavBar } from "@/components/navigation/NavBar";
import { Providers } from "@/components/providers";
import { isOperatorSession } from "@/lib/auth-session";

import "./globals.css";

/*
 * Vodafone은 독점 서체라 배포본이 없다. DS readme가 지정한 대체 서체가 Inter다.
 * DS tokens/fonts.css의 Google Fonts @import 대신 next/font를 쓴다 —
 * self-host라 렌더 블로킹 외부 요청이 없고, 폰트 메트릭 대체로 CLS가 사라진다.
 */
const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700", "800"],
  variable: "--font-inter",
  display: "swap",
});

/*
 * metadataBase가 없으면 opengraph-image의 URL이 상대 경로로 남아
 * 메신저·메일의 링크 미리보기가 이미지를 못 찾는다.
 */
export const metadata: Metadata = {
  metadataBase: new URL("https://ticket-mvp-eight.vercel.app"),
  title: "티켓 MVP",
  description:
    "2,000석 좌석맵과 서버 hold로 좌석 경합을 다루는 티켓 예매 포트폴리오 MVP",
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "티켓 MVP",
    title: "티켓 MVP",
    description:
      "2,000석 좌석맵과 서버 hold로 좌석 경합을 다루는 티켓 예매 포트폴리오 MVP",
  },
  twitter: { card: "summary_large_image" },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  /*
   * 쿠키를 읽으므로 모든 세그먼트가 동적 렌더가 된다. 정적으로 남아 있던 것은
   * 클라이언트가 데이터를 직접 받아오는 껍데기 화면들뿐이라 잃는 것이 적다.
   */
  const showOperations = await isOperatorSession();

  return (
    <html className={inter.variable} lang="ko">
      <body className="flex min-h-screen flex-col">
        {/* DS NavBar/Footer는 ink 밴드다. nav(dark) → 콘텐츠 → footer(dark)가 DS의 밴드 리듬 */}
        <NavBar showOperations={showOperations} />

        {/* Band fill이 flex-1로 늘어나려면 이 래퍼부터 세로 flex여야 한다 */}
        <div className="flex flex-1 flex-col">
          <Providers>{children}</Providers>
        </div>

        <footer className="bg-ink text-on-dark">
          <div className="mx-auto w-full max-w-7xl space-y-lg px-lg py-3xl sm:px-2xl lg:px-3xl">
            <p className="text-body-md font-extrabold tracking-tight">
              티켓 MVP
            </p>
            <p className="max-w-xl text-body-sm text-mute">
              포트폴리오용 티켓 예매 서비스입니다. 실제 결제나 발권은 이루어지지
              않습니다.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
