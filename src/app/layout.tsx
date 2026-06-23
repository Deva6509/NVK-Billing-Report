import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ASA Billing Intelligence Portal",
  description: "Enterprise Billing Intelligence Platform for ASA",
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full" suppressHydrationWarning>
      <body className="h-full antialiased">{children}</body>
    </html>
  );
}
