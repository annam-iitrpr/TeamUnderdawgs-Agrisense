import type { Metadata, Viewport } from "next";
import { LanguageProvider } from "@/components/language-provider";
import { AuthProvider } from "@/features/auth/auth-provider";
import { ServiceWorkerRegistrar } from "@/features/pwa/pwa-controls";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "AgriSense",
    template: "%s · AgriSense",
  },
  description:
    "Know the right morning to spray. Biological application timing and readiness scoring for Indian smallholder fields.",
  applicationName: "AgriSense",
  appleWebApp: {
    capable: true,
    title: "AgriSense",
    statusBarStyle: "default",
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  // Farm data is private; nothing here should be indexed or previewed.
  robots: { index: false, follow: false },
  formatDetection: { telephone: false, address: false, email: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Zoom is left enabled on purpose: pinch-zoom is an accessibility need for a
  // mixed-literacy, mixed-eyesight audience, and locking it would fail WCAG.
  themeColor: "#0b5d3b",
  // Keeps content clear of notches and home indicators when installed.
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // lang starts at "en" and the LanguageProvider updates it once the stored
  // preference is read, so server and client markup agree on first paint.
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
            {children}
          </AuthProvider>
        </LanguageProvider>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
