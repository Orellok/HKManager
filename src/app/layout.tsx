import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { connection } from "next/server";

import { SignOutForm } from "@/components/sign-out-form";
import { getVerifiedUser } from "@/lib/auth/guards";

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
  const user = await getVerifiedUser();

  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="flex min-h-dvh flex-col">
        <header className="border-b">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-2">
            <p className="py-1 text-lg font-semibold">{APP_NAME}</p>
            {user ? <SignOutForm label="יציאה" /> : null}
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
