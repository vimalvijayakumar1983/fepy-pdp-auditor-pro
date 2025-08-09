import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "FEPY PDP Auditor Pro",
  description: "Audit and improve PDP content fast.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gradient-to-br from-gray-50 to-white">{children}</body>
    </html>
  );
}
