"use client";

import { Tabs } from "radix-ui";
import { BotIcon, TerminalIcon } from "lucide-react";
import { Copy, Guide } from "@demo/Commands";
import guide from "../../generated/guide.json";

const tabStyle =
  "flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-xs";

export function SetupOptions() {
  return (
    <Tabs.Root defaultValue="agent" className="space-y-6">
      <Tabs.List
        aria-label="Setup method"
        className="grid max-w-lg grid-cols-2 gap-1 rounded-lg bg-muted p-1"
      >
        <Tabs.Trigger value="agent" className={tabStyle}>
          <BotIcon className="hidden size-4 shrink-0 sm:block" aria-hidden />
          Set up with your agent
        </Tabs.Trigger>
        <Tabs.Trigger value="manual" className={tabStyle}>
          <TerminalIcon
            className="hidden size-4 shrink-0 sm:block"
            aria-hidden
          />
          Set up manually
        </Tabs.Trigger>
      </Tabs.List>
      <Tabs.Content value="agent" className="space-y-5">
        <Guide text={guide.agentIntro} />
        <div className="overflow-hidden rounded-lg border bg-muted/40">
          <div className="flex items-center justify-end border-b px-3 py-1">
            <Copy text={guide.prompt} label="Copy prompt" />
          </div>
          <pre className="whitespace-pre-wrap break-words p-4 text-sm leading-relaxed sm:p-5">
            {guide.prompt}
          </pre>
        </div>
        <Guide text={guide.agentAfter} />
      </Tabs.Content>
      <Tabs.Content value="manual" className="space-y-5">
        <Guide text={guide.manual} />
        <h2 className="border-t pt-5 text-lg font-semibold">Clone with Git</h2>
        <Guide text={guide.clone} />
        <h2 className="border-t pt-5 text-lg font-semibold">
          Reopen Career Workspace
        </h2>
        <Guide text={guide.reopen} />
        <h2 className="border-t pt-5 text-lg font-semibold">
          Optional Gmail checks
        </h2>
        <Guide text={guide.gmail} />
        <h2 className="border-t pt-5 text-lg font-semibold">Troubleshooting</h2>
        <Guide text={guide.troubleshooting} />
      </Tabs.Content>
    </Tabs.Root>
  );
}
