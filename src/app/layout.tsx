import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { connection } from "next/server";

import "./globals.css";

const APP_NAME = "HKManager";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: APP_NAME,
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The nonce-based CSP only works when every page is rendered per request.
  await connection();

  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="flex min-h-dvh flex-col">
        <header className="border-b">
          <div className="mx-auto w-full max-w-5xl px-4 py-3">
            <p className="text-lg font-semibold">{APP_NAME}</p>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
