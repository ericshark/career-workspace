"use client";
import { useState } from "react";
import {
  BriefcaseBusinessIcon,
  Building2Icon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  LinkIcon,
  PencilIcon,
  SearchIcon,
  SearchXIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { Modal } from "@/components/Modal";
import { showToast } from "@/components/notify";
import { FOUND_LINK_LABELS, type FoundLink } from "@/lib/foundLink";
import { cn } from "@/lib/utils";
import type { ApplicationRow } from "@/lib/types";

type Kind = FoundLink["kind"];

// Short label for table chips, icon, and tint per kind, so the chip says what the link is.
const KIND_STYLE: Record<
  Kind,
  { short: string; icon: typeof LinkIcon; tone: string }
> = {
  posting: {
    short: "Posting",
    icon: BriefcaseBusinessIcon,
    tone: "border-success/25 bg-success/10 text-success hover:bg-success/20",
  },
  source: {
    short: "Source",
    icon: LinkIcon,
    tone: "border-amber-500/35 bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-300",
  },
  other: {
    short: "Posting",
    icon: GlobeIcon,
    tone: "border-dashed border-foreground/30 bg-transparent text-muted-foreground hover:bg-muted",
  },
  careers: {
    short: "Careers",
    icon: Building2Icon,
    tone: "border-sky-500/30 bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-300",
  },
  website: {
    short: "Website",
    icon: GlobeIcon,
    tone: "border-violet-500/30 bg-violet-500/10 text-violet-700 hover:bg-violet-500/20 dark:text-violet-300",
  },
  manual: {
    short: "Saved",
    icon: LinkIcon,
    tone: "border-border bg-muted text-foreground hover:bg-muted/70",
  },
};

/** "acme.com/careers/open-roles…": the host plus a trimmed path, never the whole URL. */
export function shortUrl(url: string, max = 44) {
  try {
    const parsed = new URL(url);
    const text = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname === "/" ? "" : parsed.pathname}`;
    return text.length > max ? `${text.slice(0, max - 1)}…` : text;
  } catch {
    return url;
  }
}

type Request = {
  method: "POST" | "PUT" | "PATCH" | "DELETE";
  body?: object;
};

const chipBase =
  "inline-flex h-6 max-w-full items-center gap-1 rounded-full border px-2 text-[11px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

/** A stored link as a chip named for what it is, with a hover preview of where it goes. */
export function LinkChip({
  kind,
  url,
  big = false,
  source,
  actions,
}: {
  kind: Kind;
  url: string;
  big?: boolean;
  /** Edit controls (search again, paste, remove) shown in the hover card. */
  actions?: React.ReactNode;
  /** The job board this job came from, named on its "source" link (e.g. "LinkedIn posting"). */
  source?: string;
}) {
  const label = FOUND_LINK_LABELS[kind];
  const style = KIND_STYLE[kind];
  const Icon = style.icon;
  return (
    <HoverCard openDelay={150} closeDelay={80}>
      <HoverCardTrigger asChild>
        {big ? (
          // A real Button, so it looks exactly like Job Summary and Timeline beside it.
          <Button variant="outline" size="sm" asChild>
            <a
              href={url}
              target="_blank"
              rel="noreferrer noopener"
              aria-label={`${label}: ${shortUrl(url)}`}
            >
              {label}
            </a>
          </Button>
        ) : (
          <a
            href={url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={`${label}: ${shortUrl(url)}`}
            className={cn(chipBase, style.tone)}
          >
            <Icon aria-hidden className="size-3" />
            {style.short}
            <ExternalLinkIcon aria-hidden className="size-3 opacity-70" />
          </a>
        )}
      </HoverCardTrigger>
      <HoverCardContent
        align="end"
        collisionPadding={12}
        className="w-72"
        onClick={stop}
      >
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <Icon aria-hidden className="size-3.5" />
          {FOUND_LINK_LABELS[kind]}
          <span className="ml-auto font-normal">
            {kind === "manual" ? "Added by you" : "Found by search"}
          </span>
        </div>
        <div className="mt-1.5 break-all font-mono text-[13px] font-medium">
          {shortUrl(url, 60)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Opens in a new tab · {new URL(url).protocol.replace(":", "")}
        </div>
        <Button
          variant="ghost"
          size="xs"
          className="mt-2 -ml-1.5"
          onClick={() => {
            void navigator.clipboard?.writeText(url);
            showToast("Link copied");
          }}
        >
          <CopyIcon /> Copy link
        </Button>
        {actions}
      </HoverCardContent>
    </HoverCard>
  );
}

/**
 * Everything about a job's link in one control: the labeled chip when one is stored (with a hover
 * preview), or a Find link chip when not. Searching is always started by hand: from the chip's menu,
 * which also offers pasting a link, retrying and dismissing.
 */
export function JobLinkControl({
  row,
  fileHash,
  readOnly,
  onChanged,
  variant = "chip",
}: {
  row: ApplicationRow;
  fileHash: string;
  readOnly?: boolean;
  /** Reload the applications after any change (the file hash moves on). */
  onChanged: () => Promise<unknown> | void;
  /** chip: compact for the table. full: bigger, with a management menu on a stored link. */
  variant?: "chip" | "full";
}) {
  const [busy, setBusy] = useState<"find" | "other" | null>(null);
  const [pasting, setPasting] = useState(false);
  const [pasted, setPasted] = useState("");
  const [pasteError, setPasteError] = useState("");
  const big = variant === "full";

  async function send(request: Request, success?: string): Promise<boolean> {
    try {
      const response = await fetch("/api/tracker/link", {
        method: request.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: row.key,
          lineIndex: row.lineIndex,
          fileHash,
          ...request.body,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        const message: string =
          result.message ??
          result.error?.message ??
          "Link lookup failed. Try again.";
        // A miss is remembered by the server; reloading shows the "No link found" state.
        if (response.status !== 404) showToast(message);
        else showToast("No reliable link found");
        if (request.method === "PUT") throw new Error(message);
        return false;
      }
      if (success) showToast(success);
      return true;
    } finally {
      await onChanged();
    }
  }

  async function find(replace = false) {
    setBusy("find");
    try {
      // Searching again first clears the old result, since a stored link is never searched over.
      if (replace && !(await send({ method: "DELETE" }))) return;
      await send({ method: "POST" }, "Link saved");
    } catch {
      // send() already reported the problem.
    } finally {
      setBusy(null);
    }
  }
  async function run(request: Request, success: string) {
    setBusy("other");
    try {
      await send(request, success);
    } catch {
      // send() already reported the problem.
    } finally {
      setBusy(null);
    }
  }
  async function savePasted() {
    setBusy("other");
    try {
      await send({ method: "PUT", body: { url: pasted.trim() } }, "Link saved");
      setPasting(false);
      setPasted("");
      setPasteError("");
    } catch (error) {
      setPasteError(
        error instanceof Error ? error.message : "Could not save the link.",
      );
    } finally {
      setBusy(null);
    }
  }

  const stop = (event: React.SyntheticEvent) => event.stopPropagation();
  const pasteDialog = (
    <Modal
      open={pasting}
      onClose={() => {
        setPasting(false);
        setPasteError("");
      }}
      title="Paste a link"
      width={460}
      footer={
        <>
          <Button variant="outline" onClick={() => setPasting(false)}>
            Cancel
          </Button>
          <Button
            disabled={!pasted.trim() || busy !== null}
            onClick={() => void savePasted()}
          >
            Save link
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2 text-sm">
        <p className="text-muted-foreground">
          The job posting, careers page or website for {row.company}.
        </p>
        <Input
          type="url"
          placeholder="https://…"
          aria-label="Link"
          value={pasted}
          onChange={(event) => {
            setPasted(event.target.value);
            setPasteError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && pasted.trim()) void savePasted();
          }}
        />
        {pasteError && (
          <p role="alert" className="text-destructive">
            {pasteError}
          </p>
        )}
      </div>
    </Modal>
  );

  const manage = (items: React.ReactNode) =>
    readOnly ? null : (
      <DropdownMenuContent align="start" onClick={stop}>
        {items}
      </DropdownMenuContent>
    );
  const searchItems = (retry: boolean) => (
    <>
      <DropdownMenuItem onSelect={() => void find(retry)}>
        <SearchIcon /> {retry ? "Search again" : "Search automatically"}
      </DropdownMenuItem>
      <DropdownMenuItem
        onSelect={() => {
          setPasted("");
          setPasting(true);
        }}
      >
        <LinkIcon /> Paste a link…
      </DropdownMenuItem>
    </>
  );

  // 1. A stored link: labeled chip, hover preview.
  if (row.foundLink) {
    const { kind, url } = row.foundLink;
    return (
      <span
        className="group/link inline-flex max-w-full items-center"
        onClick={stop}
      >
        <LinkChip
          kind={kind}
          url={url}
          big={big}
          source={row.source}
          actions={
            big && !readOnly ? (
              <div className="mt-1 flex flex-wrap gap-1 border-t pt-2">
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => void find(true)}
                >
                  {busy === "find" ? <Spinner /> : <SearchIcon />} Search again
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  disabled={busy !== null}
                  onClick={() => {
                    setPasted("");
                    setPasting(true);
                  }}
                >
                  <PencilIcon /> Paste a link…
                </Button>
                <Button
                  variant="ghost"
                  size="xs"
                  className="text-destructive hover:text-destructive"
                  disabled={busy !== null}
                  onClick={() => void run({ method: "DELETE" }, "Link removed")}
                >
                  Remove link
                </Button>
              </div>
            ) : undefined
          }
        />
        {pasteDialog}
      </span>
    );
  }

  if (readOnly) return <span className="text-muted-foreground">–</span>;

  // 2. Dismissed: the table stays quiet; bigger views keep a quiet way back.
  if (row.linkLookup?.kind === "ignored" && !big)
    return (
      <span
        className="text-muted-foreground"
        aria-label="Link search dismissed"
        title="Link search dismissed"
      >
        –
      </span>
    );

  const searching = busy === "find";
  const missed = row.linkLookup?.kind === "none";
  const dismissed = row.linkLookup?.kind === "ignored";
  const label = searching
    ? "Finding…"
    : missed
      ? "No link found"
      : dismissed
        ? "Add link"
        : "Find link";

  const findIcon = searching ? (
    <Spinner className="size-3" />
  ) : missed ? (
    <SearchXIcon aria-hidden className="size-3" />
  ) : (
    <SearchIcon aria-hidden className="size-3" />
  );
  return (
    <span className="inline-flex max-w-full items-center" onClick={stop}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {big ? (
            // A real Button, so it looks exactly like Job Summary and Timeline beside it.
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              aria-label={label}
              className={cn(missed && "border-warning/40 text-warning")}
            >
              {findIcon}
              {label}
            </Button>
          ) : (
            <button
              type="button"
              disabled={busy !== null}
              aria-label={label}
              className={cn(
                chipBase,
                missed
                  ? "border-warning/40 bg-warning/10 text-warning hover:bg-warning/20"
                  : "border-dashed border-foreground/25 text-muted-foreground hover:border-foreground/40 hover:bg-muted hover:text-foreground",
              )}
            >
              {findIcon}
              {label}
            </button>
          )}
        </DropdownMenuTrigger>
        {manage(
          <>
            {searchItems(false)}
            {missed && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    void run({ method: "PATCH" }, "Link search dismissed")
                  }
                >
                  Dismiss
                </DropdownMenuItem>
              </>
            )}
            {dismissed && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => void run({ method: "DELETE" }, "Reset")}
                >
                  Show Find link again
                </DropdownMenuItem>
              </>
            )}
          </>,
        )}
      </DropdownMenu>
      {pasteDialog}
    </span>
  );
}
