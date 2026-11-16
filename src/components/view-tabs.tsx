import Link from "next/link";

import { cn } from "@/lib/utils";

type ViewTab = { key: string; label: string; href: string };

type ViewTabsProps = {
  label: string;
  tabs: readonly ViewTab[];
  current: string;
};

/**
 * Links that switch a list between views (active / archive). The current one has
 * aria-current="page" and bold text with a filled background, not color alone.
 */
export function ViewTabs({ label, tabs, current }: ViewTabsProps) {
  return (
    <nav aria-label={label}>
      <ul className="flex gap-2">
        {tabs.map((tab) => {
          const isCurrent = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href}
                aria-current={isCurrent ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-11 items-center rounded-md border px-4 text-sm",
                  isCurrent
                    ? "bg-primary text-primary-foreground border-primary font-bold"
                    : "hover:bg-accent",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
