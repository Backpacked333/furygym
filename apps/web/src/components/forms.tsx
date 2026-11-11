"use client";

import { useActionState, type ComponentProps, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass, cx, type ButtonVariant } from "@/components/ui";
import type { ActionState } from "@/lib/action";

type FormAction = (state: ActionState, formData: FormData) => Promise<ActionState>;

/** A form bound to a server action that shows the action's error or success message inline. */
export function ActionForm({ action, children, className, resetOnSuccess = true, resetKey, onReset, ...props }: { action: FormAction; children: ReactNode; className?: string; resetOnSuccess?: boolean; resetKey?: string } & Omit<ComponentProps<"form">, "action">) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form
      key={resetKey}
      action={formAction}
      className={className}
      {...props}
      onReset={(event) => {
        // React resets resolved actions even when their result contains a validation error.
        if (state?.error || !resetOnSuccess) event.preventDefault();
        onReset?.(event);
      }}
    >
      {children}
      {state?.error ? (
        <p role="alert" className="mt-3 rounded-2xl bg-bad/15 px-3 py-2 text-sm text-bad">{state.error}</p>
      ) : null}
      {state?.ok ? (
        <p role="status" className="mt-3 rounded-2xl bg-good/15 px-3 py-2 text-sm text-good">{state.ok}</p>
      ) : null}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", small, confirm, className, ...props }: { children: ReactNode; variant?: ButtonVariant; small?: boolean; confirm?: string } & ComponentProps<"button">) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || props.disabled}
      className={cx(buttonClass(variant, small), className)}
      onClick={(event) => {
        if (confirm && !window.confirm(confirm)) event.preventDefault();
      }}
      {...props}
    >
      {pending ? "Working…" : children}
    </button>
  );
}

/** A one-button form: `fields` become hidden inputs. Used for row actions like check-in or cancel. */
export function ActionButton({ action, fields, children, variant = "secondary", confirm, small = true }: { action: FormAction; fields: Record<string, string | number | null | undefined>; children: ReactNode; variant?: ButtonVariant; confirm?: string; small?: boolean }) {
  const [state, formAction] = useActionState(action, null);
  return (
    <form action={formAction} className="inline-flex items-center gap-2">
      {Object.entries(fields).map(([name, value]) =>
        value == null ? null : <input key={name} type="hidden" name={name} value={String(value)} />,
      )}
      <SubmitButton variant={variant} small={small} confirm={confirm}>{children}</SubmitButton>
      {state?.error ? <span role="alert" className="text-xs text-bad">{state.error}</span> : null}
    </form>
  );
}
