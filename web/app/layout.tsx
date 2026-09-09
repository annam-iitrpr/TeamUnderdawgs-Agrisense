import type { Metadata, Viewport } from "next";
import { LanguageProvider } from "@/components/language-provider";
import { AppProvider } from "@/components/providers";
import { AuthProvider } from "@/features/auth/auth-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "AgriSense",
  description:
    "Know the right morning to spray. Biological application timing and readiness scoring for Indian smallholder fields.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b5d3b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang starts at "en" and the LanguageProvider updates it once the stored
  // preference is read, so server and client markup agree on first paint.
  //
  // AppProvider is the contract_v1 bootstrap's context. It is nested here as a
  // temporary adapter so the pre-existing screens under app/field/** and
  // app/dashboard/** keep working while P1-04 and P1-05 replace them. It is
  // removed with the last screen that calls useApp().
  return (
    <html lang="en">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] focus:rounded-control focus:bg-forest focus:px-4 focus:py-2 focus:text-white"
        >
          Skip to content
        </a>
        <LanguageProvider>
          <AuthProvider>
            <AppProvider>{children}</AppProvider>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
