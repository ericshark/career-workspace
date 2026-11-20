"use client";
import { useEffect, useState } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Modal } from "./Modal";
import { Button } from "./ui/button";
import { JobFacts, JobHeading, JobLink, jobLocation } from "./JobHeader";
import { JobSummary } from "./JobSummary";
import type { TrackerDetails } from "@/lib/trackerDetails";
import type { HistoryItem } from "@/lib/types";

export type QuickSummaryTarget = Pick<
  HistoryItem,
  "id" | "company" | "role"
> & {
  link?: string;
  status?: string;
};

const displayDate = (date: string) =>
  date.replace(/^(\d{2})(\d{2})-(\d{2})-(\d{2})$/, "$3/$4/$2");

export function QuickSummaryModal({
  item,
  onClose,
}: {
  item: QuickSummaryTarget;
  onClose: () => void;
}) {
  const [record, setRecord] = useState<TrackerDetails | null>(null);
  const [error, setError] = useState(false);
  const [originalOpen, setOriginalOpen] = useState(false);
  useEffect(() => {
    let live = true;
    setOriginalOpen(false);
    fetch(`/api/tracker/details?id=${encodeURIComponent(item.id)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Could not load summary");
        const payload = await response.json();
        if (live) setRecord(payload);
      })
      .catch(() => {
        if (live) setError(true);
      });
    return () => {
      live = false;
    };
  }, [item.id]);
  const brief = record?.displayBrief;
  const status = record?.status || item.status || "";
  const isSaved = status === "to apply" || status === "later";
  return (
    <Modal
      open
      onClose={onClose}
      width={820}
      title={
        <JobHeading
          company={record?.company || item.company}
          role={record?.role || item.role}
          large
        />
      }
      headerAction={<JobLink link={record?.link || item.link || ""} large />}
    >
      <div className="flex flex-col gap-3 pt-1">
        {error ? (
          <p role="alert">Could not load this summary.</p>
        ) : (
          <>
            {record && brief && (
              <JobFacts
                large
                source={record.source || ""}
                facts={[
                  {
                    label: "Location",
                    value: jobLocation(brief.location, brief.workMode),
                  },
                  { label: "Salary", value: brief.compensation },
                  { label: "Resume", value: record.usedResume },
                  ...(record.date
                    ? [
                        {
                          label: isSaved ? "Saved" : "Applied",
                          value: displayDate(record.date),
                        },
                      ]
                    : []),
                  ...(record.postedAt
                    ? [
                        {
                          label: "Posted",
                          value: displayDate(record.postedAt),
                        },
                      ]
                    : []),
                ]}
              />
            )}
            <JobSummary brief={brief || undefined} loading={!record} />
            {record?.original && (
              <>
                <div className="flex flex-wrap items-center gap-1 border-t pt-3">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    aria-expanded={originalOpen}
                    aria-controls="quick-original-paste"
                    onClick={() => setOriginalOpen((value) => !value)}
                  >
                    View pasted
                    <ChevronDownIcon className="size-3.5" />
                  </Button>
                </div>
                <div
                  id="quick-original-paste"
                  hidden={!originalOpen}
                  className="border-t pt-3"
                >
                  <h2 className="mb-2 text-sm font-semibold">
                    Original pasted description
                  </h2>
                  <p className="whitespace-pre-wrap break-words text-sm leading-6">
                    {record.original}
                  </p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
