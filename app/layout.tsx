import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TradeLynk — Document Consistency Check",
  description:
    "Upload export documents and compare AI-extracted fields across them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
