"use client";
import { useState } from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Markdown } from "@/components/Markdown";

export function Copy({ text, label }: { text: string; label: string }) {
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
        void Promise.resolve()
          .then(() => navigator.clipboard.writeText(text))
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
    <div className="max-w-full overflow-hidden rounded-lg border bg-muted/50">
      <div className="flex items-center justify-between border-b px-3 py-1 text-xs text-muted-foreground">
        Terminal
        <Copy text={commands.join("\n")} label="Copy all commands" />
      </div>
      <ul>
        {commands.filter(Boolean).map((command) =>
          command.startsWith("#") ? (
            <li
              key={command}
              className="px-3 pt-2 text-xs text-muted-foreground"
            >
              {command.replace(/^#\s*/, "")}
            </li>
          ) : (
            <li key={command} className="flex items-center gap-2 px-3 py-1">
              <code className="min-w-0 flex-1 overflow-x-auto font-mono text-sm whitespace-nowrap">
                {command}
              </code>
              <Copy text={command} label={`Copy: ${command}`} />
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

/** README Markdown with its sh blocks shown as copyable commands. */
export function Guide({ text }: { text: string }) {
  // Odd parts are the contents of sh fences, which may be indented inside a list.
  return text.split(/^[ ]*```sh\n([\s\S]*?)^[ ]*```[ ]*$/m).map((part, i) =>
    i % 2 ? (
      <Commands
        key={i}
        commands={part
          .trim()
          .split("\n")
          .map((line) => line.trim())}
      />
    ) : part.trim() ? (
      <Markdown key={i} className="md-reading [&_a]:underline!" externalOnly>
        {part.trim()}
      </Markdown>
    ) : null,
  );
}
