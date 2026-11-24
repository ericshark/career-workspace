import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SetupOptions } from "@demo/SetupOptions";

export const metadata: Metadata = {
  title: "How to set it up · Career Workspace",
};

export default function SetupPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-8 pb-12">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight">
          How to set it up
        </h1>
        <p className="text-muted-foreground">
          Install the full app on your computer and start with an empty
          workspace.
        </p>
      </header>
      <SetupOptions />
      <footer className="flex flex-wrap gap-2 border-t pt-6">
        <Button asChild variant="outline" size="sm">
          <Link href="/">Back to the demo</Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <a href="https://github.com/ericshark/career-workspace">
            View on GitHub
          </a>
        </Button>
      </footer>
    </article>
  );
}
