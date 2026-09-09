import type { Metadata, Viewport } from "next";
import { AppProvider } from "@/components/providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgriSense",
  description:
    "Know the right morning to spray. Biological application timing and readiness scoring for Indian smallholder fields.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0B5D3B",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-control focus:bg-forest focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
