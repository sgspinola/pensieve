import type { Metadata } from "next";
import { JetBrains_Mono, IBM_Plex_Sans } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  weight: ["400", "500", "600", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Pensieve",
  description: "Private, multi-user knowledge base for saved links, tools, and wiki articles.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // No cookie yet (first visit) defaults to dark, matching this app's
  // previous hardcoded-dark behavior. Read here (Server Component) rather
  // than detected client-side, so `data-theme` is correct on the very first
  // rendered byte — no flash of the wrong theme.
  const theme = (await cookies()).get("theme")?.value === "light" ? "light" : "dark";

  return (
    <html lang="en" data-theme={theme} className={`${jetbrainsMono.variable} ${plexSans.variable}`}>
      <body>{children}</body>
    </html>
  );
}
