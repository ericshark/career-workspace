"use client";

import { useState } from "react";
import { CheckIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** The pair a delete button turns into: a red check to confirm, a gray X to cancel. */
export function ConfirmButtons({
  onConfirm,
  onCancel,
  className,
}: {
  onConfirm: () => void;
  onCancel: () => void;
  className?: string;
}) {
  return (
    <span className={cn("flex items-center justify-center gap-1.5", className)}>
      <button
        type="button"
        autoFocus
        aria-label="Confirm delete"
        title="Confirm delete"
        onClick={onConfirm}
        className="grid h-7 flex-1 place-items-center rounded-md bg-destructive text-white transition-colors hover:bg-destructive/85 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <CheckIcon className="size-4" />
      </button>
      <button
        type="button"
        aria-label="Cancel delete"
        title="Cancel delete"
        onClick={onCancel}
        className="grid h-7 flex-1 place-items-center rounded-md bg-muted text-muted-foreground transition-colors hover:bg-muted-foreground/25 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <XIcon className="size-4" />
      </button>
    </span>
  );
}

/**
 * A delete button that asks for confirmation in place: pressing it swaps it for
 * a red check and a gray X of about the same size. No pop-up.
 */
export function ConfirmInline({
  label,
  disabled,
  onConfirm,
  className,
}: {
  label: string;
  disabled?: boolean;
  onConfirm: () => void;
  className?: string;
}) {
  const [armed, setArmed] = useState(false);
  if (armed)
    return (
      <ConfirmButtons
        className={cn("min-w-24", className)}
        onConfirm={() => {
          setArmed(false);
          onConfirm();
        }}
        onCancel={() => setArmed(false)}
      />
    );
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={disabled}
      className={cn(
        "min-w-24 text-destructive hover:text-destructive",
        className,
      )}
      onClick={() => setArmed(true)}
    >
      {label}
    </Button>
  );
}
