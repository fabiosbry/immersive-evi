import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "peoplemakethings — Voice AI",
  description: "Experience the future of voice interaction",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        {/* Noise texture overlay for that premium feel */}
        <div className="noise-overlay" />
      </body>
    </html>
  );
}

