import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "🍓 飽差管理アプリ | いちご栽培サポート",
  description: "いちご栽培のための飽差管理・記録アプリ。温度と湿度から飽差を計算し、適切な対処法を提示します。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
