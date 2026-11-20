import { compactJobBrief } from "@/lib/compactJobBrief";
import { Markdown } from "./Markdown";

export function CompactJobBrief({ children }: { children: string }) {
  return (
    <Markdown className="rounded-xl bg-muted/60 p-4 break-words text-sm leading-7 [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:tracking-normal [&_strong]:font-semibold [&_li]:my-1">
      {compactJobBrief(children)}
    </Markdown>
  );
}
