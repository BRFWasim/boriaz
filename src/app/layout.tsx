import type { Metadata, Viewport } from "next";
import { Syne, Manrope, JetBrains_Mono } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const heading = Syne({
  variable: "--font-heading",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const sans = Manrope({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "BoriazBot — Alignement & baleines Hyperliquid",
  description:
    "BoriazBot : score Alignement (TF × crowd × Nansen × IA), signaux LONG/SHORT, baleines Hyperliquid, paper trade et Telegram.",
  applicationName: "BoriazBot",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "BoriazBot",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#0c1820",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="fr"
      className={`dark ${heading.variable} ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
