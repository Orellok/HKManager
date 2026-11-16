import type { ComponentProps, MouseEvent } from "react";

import { cn } from "@/lib/utils";

export type ButtonVariant = "primary" | "secondary" | "destructive";

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/90",
  secondary: "border bg-background text-foreground hover:bg-accent",
  destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90",
};

/**
 * The button look, also for links that act as buttons ("לקוח חדש"). 44px minimum height for
 * touch (WCAG 2.5.5).
 */
export function buttonClasses(variant: ButtonVariant = "primary", className?: string): string {
  return cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60",
    VARIANT_CLASSES[variant],
    className,
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: ButtonVariant;
  /**
   * The button's action is running. Unlike `disabled`, the button keeps keyboard focus (a
   * disabled focused button drops focus to <body>): it is marked aria-disabled and aria-busy,
   * and clicks, including form submission, are ignored until the action ends.
   */
  pending?: boolean;
};

/** Native button with the app's tokens. */
export function Button({
  variant = "primary",
  className,
  type = "button",
  pending = false,
  onClick,
  ...props
}: ButtonProps) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (pending) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  }

  return (
    <button
      type={type}
      className={buttonClasses(variant, className)}
      aria-disabled={pending || undefined}
      aria-busy={pending || undefined}
      // No handler when there is nothing to handle, so Server Components can render it.
      onClick={pending || onClick ? handleClick : undefined}
      {...props}
    />
  );
}
