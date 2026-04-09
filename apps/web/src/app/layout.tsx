import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";

import { AppShell } from "@/app/_components/AppShell/AppShell";

import "./globals.module.css";
import "@/styles/design-system.css";
import { Providers } from "./providers";

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-google",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Debate Market",
  description: "Themes and debate threads powered by semantic triples."
};

export default function RootLayout({
  children
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={jetbrainsMono.variable}>
      <head>
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,600,700&display=swap"
        />
      </head>
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
