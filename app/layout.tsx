import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "설교 쇼츠 메이커",
  description:
    "설교(예배) 유튜브 링크를 넣으면 AI가 하이라이트를 찾아 쇼츠를 만들어 드립니다 (자막 on/off 가능).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        <link
          rel="preload"
          href="/fonts/Pretendard-ExtraBold.ttf"
          as="font"
          type="font/ttf"
          crossOrigin="anonymous"
        />
        <style
          dangerouslySetInnerHTML={{
            __html: `
              @font-face {
                font-family: 'Pretendard';
                font-weight: 700;
                src: url('/fonts/Pretendard-Bold.ttf') format('truetype');
                font-display: swap;
              }
              @font-face {
                font-family: 'Pretendard';
                font-weight: 800;
                src: url('/fonts/Pretendard-ExtraBold.ttf') format('truetype');
                font-display: swap;
              }
            `,
          }}
        />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
