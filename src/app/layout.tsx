import type { Metadata, Viewport } from "next";
import { DM_Sans, JetBrains_Mono } from "next/font/google";
import { PwaRegister } from "@/components/pwa-register";
import "./globals.css";

const sans = DM_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const mono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Baleines Hyperliquid — perpétuels",
  description:
    "Suivi des 10 plus gros traders perpétuels du leaderboard Hyperliquid : positions, levier, SL/TP, PnL et historique de clôture.",
  applicationName: "Baleines Hyperliquid",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "Baleines HL",
    statusBarStyle: "black-translucent",
  },
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg",
  },
};

export const viewport: Viewport = {
  themeColor: "#101625",
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
      className={`dark ${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-background text-foreground">
        <PwaRegister />
        {children}
      </body>
    </html>
  );
}
