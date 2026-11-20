"use client";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Small "copy path" button for the docs header; `label` reuses it for other text.
export function CopyPath({
  path,
  label = "Copy path",
}: {
  path: string;
  label?: string;
}) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="xs"
      className={cn(done ? "text-success" : "text-primary")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(path);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          /* clipboard unavailable (non-secure context); ignore */
        }
      }}
    >
      {done ? (
        <CheckIcon data-icon="inline-start" />
      ) : (
        <CopyIcon data-icon="inline-start" />
      )}
      {done ? "Copied" : label}
    </Button>
  );
}
