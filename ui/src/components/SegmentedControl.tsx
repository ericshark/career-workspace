"use client";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/**
 * Single-choice segmented control on a muted track. Exposed as a radiogroup (Radix renders the
 * items as radios) and never deselects: clicking the selected option keeps it selected.
 */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  size = "md",
  ariaLabel,
  stretch = false,
}: {
  options: { value: T; label: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
  ariaLabel?: string;
  /** Fill the container width with equal segments (for narrow dialogs). */
  stretch?: boolean;
}) {
  return (
    <ToggleGroup
      type="single"
      role="radiogroup"
      aria-label={ariaLabel}
      value={value}
      onValueChange={(next) => next && onChange(next as T)}
      variant="segmented"
      size={size === "sm" ? "sm" : "default"}
      spacing={0.5}
      className={cn("bg-muted p-0.5", stretch && "w-full")}
    >
      {options.map((o) => (
        <ToggleGroupItem
          key={o.value}
          value={o.value}
          className={stretch ? "min-w-0 flex-1 px-1.5" : "px-3"}
        >
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
