"use client";

import * as React from "react";
import { cn } from "cn";
import { Select as SelectPrimitive } from "radix-ui";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

export type SelectOption = string | { value: string; label: string };

// Radix items cannot use an empty value, but callers use "" for "none".
const EMPTY = "__empty__";
const toRadix = (value: string) => (value === "" ? EMPTY : value);
const fromRadix = (value: string) => (value === EMPTY ? "" : value);

/** Styled replacement for a native select: rounded menu, hairlines, check on the current value. */
function StyledSelect({
  value,
  onValueChange,
  options,
  disabled,
  className,
  "aria-label": ariaLabel,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: readonly SelectOption[];
  disabled?: boolean;
  className?: string;
  "aria-label": string;
}) {
  return (
    <SelectPrimitive.Root
      value={toRadix(value)}
      onValueChange={(next) => onValueChange(fromRadix(next))}
      disabled={disabled}
    >
      <SelectPrimitive.Trigger
        data-slot="select-trigger"
        aria-label={ariaLabel}
        className={cn(
          "flex h-8 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-input bg-transparent py-1 pr-2 pl-2.5 text-sm whitespace-nowrap transition-colors outline-none select-none hover:bg-muted/50 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[state=open]:bg-muted/50 dark:bg-input/30 dark:hover:bg-input/50",
          className,
        )}
      >
        <span className="truncate">
          <SelectPrimitive.Value />
        </span>
        <SelectPrimitive.Icon asChild>
          <ChevronDownIcon className="size-4 shrink-0 text-muted-foreground" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          data-slot="select-content"
          position="popper"
          sideOffset={4}
          className="z-50 max-h-(--radix-select-content-available-height) min-w-(--radix-select-trigger-width) origin-(--radix-select-content-transform-origin) overflow-hidden rounded-xl bg-popover p-1.5 text-popover-foreground shadow-lg ring-1 ring-foreground/10 duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95"
        >
          <SelectPrimitive.Viewport>
            {options.map((option) => {
              const { value: optionValue, label } =
                typeof option === "string"
                  ? { value: option, label: option }
                  : option;
              return (
                <SelectPrimitive.Item
                  key={optionValue}
                  value={toRadix(optionValue)}
                  data-slot="select-item"
                  className="relative flex cursor-default items-center gap-2 rounded-lg py-2 pr-8 pl-2.5 text-sm outline-hidden select-none focus:bg-accent focus:text-accent-foreground data-disabled:pointer-events-none data-disabled:opacity-50 [[data-slot=select-item]+&]:before:absolute [[data-slot=select-item]+&]:before:inset-x-2.5 [[data-slot=select-item]+&]:before:-top-px [[data-slot=select-item]+&]:before:h-px [[data-slot=select-item]+&]:before:bg-border/70"
                >
                  <SelectPrimitive.ItemText>{label}</SelectPrimitive.ItemText>
                  <SelectPrimitive.ItemIndicator className="absolute right-2.5 flex items-center">
                    <CheckIcon className="size-4" />
                  </SelectPrimitive.ItemIndicator>
                </SelectPrimitive.Item>
              );
            })}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}

export { StyledSelect };
