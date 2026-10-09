import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FEPY PDP Auditor Pro",
  description:
    "A persistent workspace for evidence-backed product page improvements.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">{children}</body>
    </html>
  );
}
