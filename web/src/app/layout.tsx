import type { Metadata } from "next";
import { Bricolage_Grotesque, JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

import { Providers } from "./providers";

// A deliberate three-role pairing, not the Geist/Inter defaults every other
// Next.js starter ships with: Bricolage Grotesque carries real character for
// headings and the wordmark, Plus Jakarta Sans stays highly legible at UI
// sizes for body copy, and JetBrains Mono covers code/paths/badges. All
// three are self-hosted at build time by next/font — no runtime font CDN
// request, no layout-shift flash.
const bricolage = Bricolage_Grotesque({
  variable: "--font-heading",
  subsets: ["latin"],
});

const plusJakarta = Plus_Jakarta_Sans({
  variable: "--font-sans",
  subsets: ["latin"],
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SyncSpace",
  description: "Real-time collaborative documents and whiteboards.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${bricolage.variable} ${plusJakarta.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
