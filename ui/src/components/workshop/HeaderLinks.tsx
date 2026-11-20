"use client";

import { useState } from "react";
import {
  CheckIcon,
  ExternalLinkIcon,
  FolderIcon,
  Link2Icon,
  MoreHorizontalIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { Item } from "@/lib/workshop/model";

/** Light chip behind a shortcut: shared by card links and the popup header. */
export const chipClass =
  "inline-flex h-6 max-w-full min-w-0 shrink-0 items-center gap-1 rounded-md bg-muted/60 px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&>svg]:size-3 [&>svg]:shrink-0";

/** lucide-react ships no brand icons, so this is the GitHub mark. */
export function GithubIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.87-1.37-3.87-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z" />
    </svg>
  );
}

export const hostLabel = (href: string) =>
  href.replace(/^https?:\/\//i, "").replace(/\/$/, "");

/** GitHub and Live site as light chips with their own icons. */
export function ChipLink({
  href,
  kind,
  label,
}: {
  href: string;
  kind: "github" | "live" | "other";
  label: string;
}) {
  return (
    <a
      className={chipClass}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
    >
      {kind === "github" ? (
        <GithubIcon />
      ) : kind === "live" ? (
        <Link2Icon className="text-emerald-600 dark:text-emerald-400" />
      ) : (
        <ExternalLinkIcon />
      )}
      <span className="truncate">{label}</span>
    </a>
  );
}

/** Copies the saved project folder's raw absolute path. */
export function PathChip({ folder }: { folder: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title={folder}
      className={cn(chipClass, copied && "text-success")}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(folder);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable (non-secure context); ignore */
        }
      }}
    >
      {copied ? <CheckIcon /> : <FolderIcon />}
      <span aria-live="polite">{copied ? "Copied" : "Path"}</span>
    </button>
  );
}

/**
 * The shared popup header: GitHub, Live site and Path, plus a compact menu for
 * any additional saved URLs. Renders nothing when there is nothing to show.
 */
export function HeaderLinks({ item }: { item: Item }) {
  if (
    !item.githubUrl &&
    !item.liveUrl &&
    !item.localFolder &&
    !item.links.length
  )
    return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.githubUrl && (
        <ChipLink href={item.githubUrl} kind="github" label="GitHub" />
      )}
      {item.liveUrl && (
        <ChipLink href={item.liveUrl} kind="live" label="Live site" />
      )}
      {item.localFolder && <PathChip folder={item.localFolder} />}
      {item.links.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className={chipClass}>
              <MoreHorizontalIcon />
              <span>More links</span>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-w-72 min-w-44">
            {item.links.map((href) => (
              <DropdownMenuItem key={href} asChild>
                <a href={href} target="_blank" rel="noopener noreferrer">
                  <ExternalLinkIcon />
                  <span className="truncate">{hostLabel(href)}</span>
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
