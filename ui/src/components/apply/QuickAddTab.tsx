"use client";
import { useHideQuestions } from "@/components/Settings";
import { ExtrasFields, NO_EXTRAS, type ExtrasAsk } from "../ExtrasPanel";
import { PlusIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { SOURCES } from "../applyHelpers";
import { SourceDot } from "@/components/SourceDot";
import { QuickJobList, type ExistingQuickLink } from "./QuickJobList";
import { draftLabel, type QuickDraft } from "./useQuickDrafts";

/**
 * The Quick add form: the job cards, then one bar with Add questions, the batch source and the
 * page's single Quick add button (rendered by the page as `submitButton`). Add questions opens a
 * panel whose answers are written for the chosen job right after the batch is logged.
 */
export function QuickAddTab({
  drafts,
  queued,
  busy,
  existingLinks,
  onUpdate,
  onAdd,
  onRemove,
  onSubmit,
  source,
  onSource,
  questionsOpen,
  onQuestionsOpen,
  ask,
  onAsk,
  extrasDraft,
  onExtrasDraft,
  submitButton,
}: {
  drafts: QuickDraft[];
  queued: QuickDraft[];
  busy: boolean;
  existingLinks?: ExistingQuickLink[];
  onUpdate: (id: string, patch: Partial<Omit<QuickDraft, "id">>) => void;
  onAdd: () => string | null;
  onRemove: (id: string) => void;
  onSubmit: () => void;
  source: string;
  onSource: (s: string) => void;
  questionsOpen: boolean;
  onQuestionsOpen: (open: boolean) => void;
  ask: ExtrasAsk;
  onAsk: (a: ExtrasAsk) => void;
  extrasDraft: QuickDraft | undefined;
  onExtrasDraft: (id: string) => void;
  submitButton: React.ReactNode;
}) {
  const hideQuestions = useHideQuestions();
  return (
    <>
      <QuickJobList
        drafts={drafts}
        disabled={busy}
        existingLinks={existingLinks}
        onUpdate={onUpdate}
        onAdd={onAdd}
        onRemove={onRemove}
        onSubmit={onSubmit}
      />

      {questionsOpen && !hideQuestions && (
        <div
          className="animate-rise flex flex-col gap-3 rounded-lg border p-3"
          aria-label="Questions for one job"
          role="group"
        >
          <div className="flex items-start gap-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">Application questions</div>
              <p className="text-xs text-muted-foreground">
                Generated for one job right after Quick add logs it.
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground"
              onClick={() => {
                onAsk(NO_EXTRAS);
                onQuestionsOpen(false);
              }}
              disabled={busy}
              aria-label="Remove questions"
              title="Remove questions"
            >
              <XIcon />
            </Button>
          </div>
          {queued.length > 0 && extrasDraft && (
            <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
              For job
              <NativeSelect
                className="w-full sm:max-w-sm"
                value={extrasDraft.id}
                disabled={busy || queued.length === 1}
                onChange={(e) => onExtrasDraft(e.target.value)}
              >
                {queued.map((d) => (
                  <NativeSelectOption key={d.id} value={d.id}>
                    {draftLabel(d, drafts.indexOf(d) + 1)}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </label>
          )}
          <ExtrasFields value={ask} onChange={onAsk} disabled={busy} />
        </div>
      )}

      <Separator />
      <div className="flex flex-wrap items-center gap-2">
        {!questionsOpen && !hideQuestions && (
          <Button
            type="button"
            variant="outline"
            onClick={() => onQuestionsOpen(true)}
            disabled={busy}
          >
            <PlusIcon data-icon="inline-start" />
            Add questions
          </Button>
        )}
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
