import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "SP's Promo Analyzer",
  description: "Analyze financial newsletter promos against the 16-Word Sales Letter framework",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <head>
        {/* Hide page immediately — hub-nav.js reveals it after auth check */}
        <style>{`html { visibility: hidden; }`}</style>
        <script src="https://oxfordhub.app/hub-nav.js" data-project-id="promo-analyzer" />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
      </body>
    </html>
  );
}
