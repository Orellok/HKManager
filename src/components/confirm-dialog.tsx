"use client";

import { useId, useRef } from "react";

import { Button, type ButtonVariant } from "@/components/button";

type ConfirmDialogProps = {
  /** Label of the button that opens the dialog. */
  triggerLabel: string;
  triggerVariant?: ButtonVariant;
  /** A fuller accessible name when several triggers share a label (it must contain it). */
  triggerAriaLabel?: string;
  /** Id of the trigger, for moving focus to it after a related action. */
  triggerId?: string;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  pending: boolean;
  /** A failure of the confirmed action, shown inside the dialog. */
  error: string | null;
};

/**
 * A modal confirmation for a destructive action, built on the native <dialog> element:
 * showModal() makes the rest of the page inert (focus stays in the dialog) and Escape closes
 * it. Focus starts on the safe choice (cancel) and returns to the trigger on close.
 */
export function ConfirmDialog({
  triggerLabel,
  triggerVariant = "destructive",
  triggerAriaLabel,
  triggerId,
  title,
  description,
  confirmLabel,
  pendingLabel,
  cancelLabel,
  onConfirm,
  pending,
  error,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  function open() {
    dialogRef.current?.showModal();
    cancelRef.current?.focus();
  }

  function close() {
    dialogRef.current?.close();
  }

  return (
    <>
      <Button
        ref={triggerRef}
        id={triggerId}
        variant={triggerVariant}
        onClick={open}
        aria-haspopup="dialog"
        aria-label={triggerAriaLabel}
      >
        {triggerLabel}
      </Button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => triggerRef.current?.focus()}
        onCancel={(event) => {
          if (pending) {
            event.preventDefault();
          }
        }}
        className="bg-background text-foreground m-auto w-[calc(100%-2rem)] max-w-md rounded-lg border p-6 shadow-lg backdrop:bg-black/50"
      >
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        <p id={descriptionId} className="text-muted-foreground mt-2 text-sm">
          {description}
        </p>
        <p role="alert" className="text-destructive mt-3 text-sm">
          {error}
        </p>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <Button ref={cancelRef} variant="secondary" onClick={close} pending={pending}>
            {cancelLabel}
          </Button>
          <Button variant="destructive" onClick={onConfirm} pending={pending}>
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </dialog>
    </>
  );
}
