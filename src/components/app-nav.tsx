"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string };

/** Only screens that exist appear here; each later feature adds its own item (M1.1). */
const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "בית" },
  { href: "/clients", label: "לקוחות" },
];

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Main navigation: a bar fixed to the bottom of the screen on mobile, a side column on
 * desktop. The current item has aria-current="page" and a visible bar and bold text, so it is
 * not shown by color alone.
 */
export function AppNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="ניווט ראשי"
      className="bg-background fixed inset-x-0 bottom-0 z-10 border-t pb-[env(safe-area-inset-bottom)] md:static md:w-48 md:shrink-0 md:border-t-0 md:border-e md:pb-0"
    >
      <ul className="flex md:flex-col md:gap-1 md:px-4 md:py-6">
        {NAV_ITEMS.map((item) => {
          const current = isCurrent(pathname, item.href);
          return (
            <li key={item.href} className="flex-1 md:flex-none">
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "hover:bg-accent relative flex min-h-14 items-center justify-center px-4 text-sm transition-colors md:min-h-11 md:justify-start md:rounded-md",
                  current
                    ? "text-foreground font-bold before:bg-primary before:absolute before:inset-x-4 before:top-0 before:h-1 before:rounded-b-sm md:bg-accent md:before:inset-x-auto md:before:inset-y-2 md:before:start-0 md:before:h-auto md:before:w-1 md:before:rounded-sm"
                    : "text-muted-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
