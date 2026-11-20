"use client";
import { useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Modal dialog with a header title, a scrolling body and an optional footer. Escape or an outside
 * click closes it and Radix traps focus. On open, focus goes to the first form field when there is
 * one (else the dialog itself), not to the first button.
 */
export function Modal({
  open,
  onClose,
  title,
  headerAction,
  headerTop,
  headerLinks,
  titleClassName,
  children,
  width = 520,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  headerAction?: React.ReactNode;
  headerTop?: React.ReactNode;
  headerLinks?: React.ReactNode;
  titleClassName?: string;
  children: React.ReactNode;
  width?: number;
  footer?: React.ReactNode;
}) {
  // Radix only returns focus to a DialogTrigger; these dialogs open from code (a row, a button
  // elsewhere), so remember what had focus and restore it on close. The cleanup also covers a
  // caller that unmounts the dialog instead of closing it, and its timer runs after Radix's own.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    return () => {
      const element = opener.current;
      setTimeout(() => {
        if (element?.isConnected) element.focus();
      }, 0);
    };
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        style={{ maxWidth: `min(${width}px, calc(100% - 2rem))` }}
        className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-none"
        aria-describedby={undefined}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          opener.current = document.activeElement as HTMLElement | null;
          const content = event.currentTarget as HTMLElement;
          const field = content.querySelector<HTMLElement>(
            "input:not([type=checkbox]):not([type=radio]), textarea, select",
          );
          (field ?? content).focus();
        }}
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          // Radix listens in capture; let an inline editor cancel before the dialog closes.
          if (
            event.target instanceof HTMLElement &&
            event.target.closest("[data-handles-escape]")
          )
            event.preventDefault();
        }}
      >
        <DialogHeader className="px-5 pt-4 pr-12 pb-2">
          {headerTop}
          <div
            className={cn(
              "flex gap-3",
              headerLinks ? "flex-wrap items-center" : "items-start",
            )}
          >
            <DialogTitle
              className={cn(
                "min-w-0 flex-1 text-lg font-semibold tracking-tight",
                !title && "sr-only",
                titleClassName,
              )}
            >
              {title ?? "Dialog"}
            </DialogTitle>
            {headerLinks}
            {headerAction}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5">
          {children}
        </div>
        {footer ? (
          <DialogFooter className="mx-0 mb-0 px-5 py-3">{footer}</DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
