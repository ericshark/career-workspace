"use client";
import { ExternalLinkIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  SOURCES,
  compressPastedText,
  pastedUrl,
  splitJobPaste,
} from "../applyHelpers";
import { SourceDot } from "@/components/SourceDot";
import { insertAtCursor } from "./QuickJobList";

function hostname(link: string): string {
  try {
    return new URL(link).hostname.replace(/^www\./, "");
  } catch {
    return link;
  }
}

/**
 * The Review form: one box for everything. Pasting a lone URL sets the posting link (shown as a chip);
 * pasting text compresses it into the description. The review always uses the tech master and the
 * last source picked.
 */
export function ReviewTab({
  textareaRef,
  jobPost,
  onJobPost,
  link,
  onLink,
  source,
  onSource,
  minChars,
  onSubmit,
  submitButton,
  progress,
}: {
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  jobPost: string;
  onJobPost: (v: string) => void;
  link: string;
  onLink: (v: string) => void;
  source: string;
  onSource: (s: string) => void;
  minChars: number;
  onSubmit: () => void;
  submitButton: React.ReactNode;
  progress?: React.ReactNode;
}) {
  const chars = jobPost.trim().length;
  const short = chars > 0 && chars < minChars;
  return (
    <>
      {link.trim() ? (
        <div className="flex items-center gap-2">
          <Badge
            variant="secondary"
            className="h-7 max-w-full min-w-0 gap-2 pr-1 pl-3 text-sm"
          >
            <ExternalLinkIcon className="text-muted-foreground" />
            <a
              href={link}
              target="_blank"
              rel="noreferrer noopener"
              className="min-w-0 truncate font-medium hover:underline"
              title={link}
            >
              {hostname(link)}
            </a>
            <button
              type="button"
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
              onClick={() => onLink("")}
              aria-label="Remove link"
              title="Remove link"
            >
              <XIcon />
            </button>
          </Badge>
        </div>
      ) : null}
      <div className="relative">
        <label htmlFor="jobpost" className="sr-only">
          Job post
        </label>
        <Textarea
          id="jobpost"
          ref={textareaRef}
          rows={5}
          autoFocus
          placeholder="Paste the job URL and the job description here, in any order…"
          className="min-h-32 resize-y field-sizing-fixed p-4 pb-7 leading-relaxed"
          value={jobPost}
          onChange={(e) => onJobPost(e.target.value)}
          onPaste={(e) => {
            const raw = e.clipboardData.getData("text");
            if (!raw) return;
            e.preventDefault();
            const paste = splitJobPaste(raw);
            if (paste.link) onLink(paste.link);
            if (paste.text)
              insertAtCursor(e.currentTarget, paste.text, onJobPost);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
        <span
          className={cn(
            "pointer-events-none absolute right-4 bottom-3 text-xs tabular-nums",
            short ? "text-warning" : "text-muted-foreground",
          )}
        >
          {chars ? (short ? `${chars}/${minChars} min` : chars) : ""}
        </span>
      </div>
      {progress}
      <Separator />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
          <span className="sr-only sm:not-sr-only">Source</span>
          <SourceDot source={source} size={8} />
          <NativeSelect
            aria-label="Source"
            value={source}
            onChange={(e) => onSource(e.target.value)}
          >
            {SOURCES.map((s) => (
              <NativeSelectOption key={s} value={s}>
                {s}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        <div className="ml-auto">{submitButton}</div>
      </div>
    </>
  );
}
