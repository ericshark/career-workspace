"use client";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

function Copy({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <Button
      size="sm"
      variant="ghost"
      aria-label={
        state === "idle"
          ? label
          : state === "copied"
            ? "Copied"
            : "Select the text to copy it"
      }
      onClick={() =>
        void navigator.clipboard
          .writeText(text)
          .then(() => setState("copied"))
          .catch(() => setState("failed"))
          .finally(() => setTimeout(() => setState("idle"), 2000))
      }
    >
      {state === "copied" ? <CheckIcon /> : <CopyIcon />}
      {state === "copied"
        ? "Copied"
        : state === "failed"
          ? "Select to copy"
          : "Copy"}
    </Button>
  );
}

export function Commands({ commands }: { commands: string[] }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        Clone, set up and launch
        <Copy text={commands.join("\n")} label="Copy all commands" />
      </div>
      <ul>
        {commands.map((command) => (
          <li key={command} className="flex items-center gap-2 px-3 py-1">
            <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap">
              {command}
            </code>
            <Copy text={command} label={`Copy: ${command}`} />
          </li>
        ))}
      </ul>
    </div>
  );
}
