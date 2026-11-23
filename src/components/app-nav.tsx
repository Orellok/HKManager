"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from "react";

import { BADGE_DISPLAY_MAX, badgeDisplayText, badgeSpokenSuffix } from "@/lib/tasks/grouping";
import { CALENDAR_PATH, TASKS_PATH } from "@/lib/tasks/paths";
import { cn } from "@/lib/utils";

type NavItem = { href: string; label: string; badge?: "tasks" };

/**
 * Owner decision (M3): the mobile bottom bar holds these, then "עוד" with MORE_ITEMS; the
 * desktop side column shows every item. Only screens that exist appear (M1.1).
 */
const PRIMARY_ITEMS: readonly NavItem[] = [
  { href: "/", label: "בית" },
  { href: "/clients", label: "לקוחות" },
  { href: "/projects", label: "פרויקטים" },
  { href: "/incomes", label: "הכנסות" },
];

const MORE_ITEMS: readonly NavItem[] = [
  // TASK-6 with the NOTIF-1 badge, and the in-app calendar (CAL-11), M6.
  { href: TASKS_PATH, label: "משימות", badge: "tasks" },
  { href: CALENDAR_PATH, label: "יומן" },
  // Owner decision (M1.3): the open debts screen (MS-6).
  { href: "/debts", label: "חובות" },
  // EXP-4.
  { href: "/expenses", label: "הוצאות" },
  // EXPORT-1 (M4.2).
  { href: "/export", label: "ייצוא" },
  // SPEC 5.14 / EXP-3.
  { href: "/settings", label: "הגדרות" },
];

const MORE_LABEL = "עוד";

function isCurrent(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

const ITEM_CLASSES =
  "hover:bg-accent relative flex min-h-14 w-full items-center justify-center px-1 text-sm transition-colors md:min-h-11 md:justify-start md:rounded-md md:px-4";
/** The current item: a bar and bold text, so it is not shown by color alone. */
const CURRENT_CLASSES =
  "text-foreground font-bold before:bg-primary before:absolute before:inset-x-2 before:top-0 before:h-1 before:rounded-b-sm md:bg-accent md:before:inset-x-auto md:before:inset-y-2 md:before:start-0 md:before:h-auto md:before:w-1 md:before:rounded-sm";

/**
 * NOTIF-1: the number of tasks to handle, as a pill next to a label. The digits are hidden
 * from screen readers, which hear the label's suffix instead (e.g. "משימות, 3 לטיפול"), so
 * the accessible name starts with the visible label. Nothing for 0.
 */
function Badge({ count, kind }: { count: number; kind: "tasks" | "more" }) {
  if (count <= 0) {
    return null;
  }
  return (
    <>
      <span
        aria-hidden="true"
        title={count > BADGE_DISPLAY_MAX ? String(count) : undefined}
        className="bg-destructive text-destructive-foreground ms-1.5 inline-flex min-w-6 items-center justify-center rounded-full px-1.5 text-xs leading-5 font-bold"
      >
        {badgeDisplayText(count)}
      </span>
      <span className="sr-only">{badgeSpokenSuffix(count, kind)}</span>
    </>
  );
}

type NavLinkProps = {
  item: NavItem;
  current: boolean;
  tasksBadge: number;
  className?: string;
  onClick?: () => void;
};

function NavLink({ item, current, tasksBadge, className, onClick }: NavLinkProps) {
  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      className={cn(ITEM_CLASSES, current ? CURRENT_CLASSES : "text-muted-foreground", className)}
    >
      {item.label}
      {item.badge === "tasks" ? <Badge count={tasksBadge} kind="tasks" /> : null}
    </Link>
  );
}

/**
 * Main navigation: a bar fixed to the bottom of the screen on mobile, a side column on
 * desktop. The current item has aria-current="page". On mobile, "עוד" is a disclosure button
 * (aria-expanded) that shows the rest of the items above the bar; it is marked current too
 * (aria-current="true") while one of them is the current screen. Escape or a click outside
 * closes it and returns focus to the button; moving focus out of it (Tab) or opening another
 * screen closes it.
 *
 * NOTIF-1: `tasksBadge` (overdue + today's open tasks, from the server on every load) shows
 * on "משימות" and, on mobile, on "עוד" too, which holds it.
 */
export function AppNav({ tasksBadge }: { tasksBadge: number }) {
  const pathname = usePathname();
  const menuId = useId();
  // Open only on the screen it was opened on, so navigating closes it without an effect.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const moreRef = useRef<HTMLLIElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const moreIsCurrent = MORE_ITEMS.some((item) => isCurrent(pathname, item.href));

  useEffect(() => {
    if (!open) {
      return;
    }
    function closeOnOutsideClick(event: PointerEvent) {
      if (event.target instanceof Node && !moreRef.current?.contains(event.target)) {
        setOpenOn(null);
      }
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () => document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [open]);

  function closeOnEscape(event: KeyboardEvent<HTMLLIElement>) {
    if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpenOn(null);
      buttonRef.current?.focus();
    }
  }

  /** Tabbing (or any focus move) out of the menu and its button closes it. */
  function closeOnFocusOut(event: FocusEvent<HTMLLIElement>) {
    const next = event.relatedTarget;
    if (open && !(next instanceof Node && moreRef.current?.contains(next))) {
      setOpenOn(null);
    }
  }

  return (
    <nav
      aria-label="ניווט ראשי"
      className="bg-background fixed inset-x-0 bottom-0 z-10 border-t pb-[env(safe-area-inset-bottom)] md:static md:w-48 md:shrink-0 md:border-t-0 md:border-e md:pb-0"
    >
      <ul className="flex md:flex-col md:gap-1 md:px-4 md:py-6">
        {PRIMARY_ITEMS.map((item) => (
          <li key={item.href} className="flex-1 md:flex-none">
            <NavLink item={item} current={isCurrent(pathname, item.href)} tasksBadge={tasksBadge} />
          </li>
        ))}
        {MORE_ITEMS.map((item) => (
          <li key={item.href} className="hidden md:block">
            <NavLink item={item} current={isCurrent(pathname, item.href)} tasksBadge={tasksBadge} />
          </li>
        ))}
        <li
          ref={moreRef}
          className="relative flex-1 md:hidden"
          onKeyDown={closeOnEscape}
          onBlur={closeOnFocusOut}
        >
          <button
            ref={buttonRef}
            type="button"
            aria-expanded={open}
            aria-controls={menuId}
            aria-current={moreIsCurrent ? "true" : undefined}
            onClick={() => setOpenOn(open ? null : pathname)}
            className={cn(
              ITEM_CLASSES,
              moreIsCurrent ? CURRENT_CLASSES : "text-muted-foreground",
              open && "bg-accent",
            )}
          >
            {MORE_LABEL}
            <Badge count={tasksBadge} kind="more" />
          </button>
          <ul
            id={menuId}
            hidden={!open}
            className="bg-background absolute end-1 bottom-full mb-2 min-w-44 rounded-md border p-1 shadow-md"
          >
            {MORE_ITEMS.map((item) => (
              <li key={item.href}>
                <NavLink
                  item={item}
                  current={isCurrent(pathname, item.href)}
                  tasksBadge={tasksBadge}
                  onClick={() => setOpenOn(null)}
                  className="min-h-11 justify-start rounded-md px-4 before:inset-x-auto before:inset-y-2 before:start-0 before:top-auto before:h-auto before:w-1 before:rounded-sm"
                />
              </li>
            ))}
          </ul>
        </li>
      </ul>
    </nav>
  );
}
