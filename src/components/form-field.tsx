import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

type FieldProps = {
  name: string;
  label: string;
  /** Shown after the label, e.g. "(חובה)". */
  requiredMark?: string;
  error?: string;
  /** Ids of more elements that describe the field, e.g. a warning below it. */
  describedBy?: string;
  /** A short help text under the label, e.g. the expected format. */
  hint?: string;
};

const CONTROL_CLASSES =
  "border-input bg-background w-full rounded-md border px-3 text-base aria-invalid:border-destructive aria-invalid:border-2";

function fieldIds(name: string) {
  const id = `field-${name}`;
  return { id, errorId: `${id}-error`, hintId: `${id}-hint` };
}

/** Attributes that tie a control to its label, hint and error. */
function controlAttributes({ name, error, describedBy, hint }: FieldProps) {
  const { id, errorId, hintId } = fieldIds(name);
  const describedByIds = [error ? errorId : null, hint ? hintId : null, describedBy]
    .filter(Boolean)
    .join(" ");
  return {
    id,
    name,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": describedByIds || undefined,
  };
}

function FieldShell({
  name,
  label,
  requiredMark,
  error,
  hint,
  children,
}: FieldProps & { children: ReactNode }) {
  const { id, errorId, hintId } = fieldIds(name);
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
        {requiredMark ? (
          <span className="text-muted-foreground font-normal"> {requiredMark}</span>
        ) : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-muted-foreground text-sm">
          {hint}
        </p>
      ) : null}
      {children}
      {error ? (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type TextInputFieldProps = FieldProps & Omit<ComponentProps<"input">, "name" | "id">;

/**
 * A labelled text input with its error beside it. The error is linked with aria-describedby
 * and the field is marked aria-invalid, so screen readers read both.
 */
export function TextInputField({
  name,
  label,
  requiredMark,
  error,
  describedBy,
  hint,
  className,
  ...inputProps
}: TextInputFieldProps) {
  const field = { name, label, requiredMark, error, describedBy, hint };
  return (
    <FieldShell {...field}>
      <input
        {...inputProps}
        {...controlAttributes(field)}
        className={cn(CONTROL_CLASSES, "min-h-11", className)}
      />
    </FieldShell>
  );
}

type TextareaFieldProps = FieldProps & Omit<ComponentProps<"textarea">, "name" | "id">;

/** A labelled textarea with its error beside it (see TextInputField). */
export function TextareaField({
  name,
  label,
  requiredMark,
  error,
  describedBy,
  hint,
  className,
  ...textareaProps
}: TextareaFieldProps) {
  const field = { name, label, requiredMark, error, describedBy, hint };
  return (
    <FieldShell {...field}>
      <textarea
        {...textareaProps}
        {...controlAttributes(field)}
        className={cn(CONTROL_CLASSES, "min-h-28 py-2", className)}
      />
    </FieldShell>
  );
}

type SelectFieldProps = FieldProps &
  Omit<ComponentProps<"select">, "name" | "id" | "children"> & {
    options: readonly { value: string; label: string }[];
    /** A first, empty choice such as "בחירת לקוח"; it submits "". */
    placeholder?: string;
  };

/** A labelled native select with its error beside it (see TextInputField). */
export function SelectField({
  name,
  label,
  requiredMark,
  error,
  describedBy,
  hint,
  className,
  options,
  placeholder,
  ...selectProps
}: SelectFieldProps) {
  const field = { name, label, requiredMark, error, describedBy, hint };
  return (
    <FieldShell {...field}>
      <select
        {...selectProps}
        {...controlAttributes(field)}
        className={cn(CONTROL_CLASSES, "min-h-11", className)}
      >
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </FieldShell>
  );
}
