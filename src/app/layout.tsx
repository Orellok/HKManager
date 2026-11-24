import type { Metadata, Viewport } from "next";
import { Heebo } from "next/font/google";
import { connection } from "next/server";

import { AppNav } from "@/components/app-nav";
import { ServiceWorkerRegistration } from "@/components/service-worker-registration";
import { SignOutForm } from "@/components/sign-out-form";
import { getUserAccess } from "@/lib/auth/guards";
import { todayInJerusalem } from "@/lib/dates";
import { logDbFailure } from "@/lib/log";
import { APP_NAME, THEME_COLOR } from "@/lib/pwa/manifest";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { badgeCount } from "@/lib/tasks/grouping";
import { getTaskReminderCounts } from "@/lib/tasks/queries";
import { cn } from "@/lib/utils";

import "./globals.css";

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
  themeColor: THEME_COLOR,
};

/**
 * NOTIF-1 / NOTIF-3: the navigation badge, the open tasks that are overdue or due today,
 * computed from the data on every load (no dependency on Push or a scheduled job). A failure
 * leaves the badge out rather than the navigation.
 */
async function loadTasksBadgeCount(): Promise<number> {
  try {
    const counts = await getTaskReminderCounts(
      await createSupabaseServerClient(),
      todayInJerusalem(),
    );
    return badgeCount(counts);
  } catch (error) {
    logDbFailure("tasks", "read badge count", error);
    return 0;
  }
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // The nonce-based CSP only works when every page is rendered per request.
  await connection();
  const { user, decision } = await getUserAccess();
  // The navigation is for allowlisted users only; never on /login or "אין הרשאה".
  const showNav = decision === "allow";
  const tasksBadge = showNav ? await loadTasksBadgeCount() : 0;

  return (
    <html lang="he" dir="rtl" className={heebo.variable}>
      <body className="flex min-h-dvh flex-col">
        <ServiceWorkerRegistration />
        <header className="border-b">
          <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-2">
            <p className="py-1 text-lg font-semibold">{APP_NAME}</p>
            {user ? <SignOutForm label="יציאה" /> : null}
          </div>
        </header>
        <div className="mx-auto flex w-full max-w-5xl flex-1">
          {showNav ? <AppNav tasksBadge={tasksBadge} /> : null}
          {/* On mobile the bottom navigation is fixed; the extra bottom padding keeps it from
              covering the end of the page. */}
          <main className={cn("min-w-0 flex-1 px-4 py-6", showNav && "pb-24 md:pb-6")}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
