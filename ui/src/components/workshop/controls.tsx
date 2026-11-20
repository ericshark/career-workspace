import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StyledSelect, type SelectOption } from "@/components/ui/select";

export function Field({
  label,
  icon,
  children,
}: {
  label: string;
  /** Small icon shown before the label. */
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-sm font-medium">
      <span className="flex items-center gap-1.5">
        {icon && (
          <span
            aria-hidden="true"
            className="text-muted-foreground [&>svg]:size-3.5"
          >
            {icon}
          </span>
        )}
        {label}
      </span>
      {children}
    </label>
  );
}

export function Select({
  options,
  value,
  onValueChange,
  ...props
}: {
  options: readonly SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  "aria-label": string;
}) {
  return (
    <StyledSelect
      options={options}
      value={value}
      onValueChange={onValueChange}
      className="w-full min-w-0"
      {...props}
    />
  );
}

export function Failure({
  message,
  onReload,
}: {
  message: string;
  onReload?: () => void;
}) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
    >
      <span>{message}</span>
      {onReload && (
        <Button variant="outline" type="button" onClick={onReload}>
          Reload latest
        </Button>
      )}
    </div>
  );
}

class WorkshopRequestError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export function isWorkshopConflict(error: unknown) {
  return error instanceof WorkshopRequestError && error.status === 409;
}

export async function workshopRequest<T>(
  endpoint = "/api/workshop",
  body?: object,
): Promise<T> {
  const response = await fetch(
    endpoint,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : { cache: "no-store" },
  );
  const data = await response.json();
  if (!response.ok) {
    const error = data.error;
    const issue = error?.details?.[0];
    const message = issue?.message
      ? [issue.path?.join("."), issue.message].filter(Boolean).join(" — ")
      : error?.message;
    throw new WorkshopRequestError(
      message ?? "Workshop request failed. Try again.",
      response.status,
    );
  }
  return data as T;
}
