import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "FootballCoach — AI Football Analytics Platform",
  description: "Computer Vision & YOLO-powered tactical football analytics platform for elite coaches.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark`}>
      <body className="min-h-screen bg-[#020E1D] text-[#F8FAFC] antialiased selection:bg-[#0B5CFF] selection:text-white">
        {children}
      </body>
    </html>
  );
}
