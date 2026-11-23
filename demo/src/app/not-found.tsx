import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-xl space-y-3 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">
        Not part of the demo
      </h1>
      <p className="text-muted-foreground">
        This page is available in the local edition.
      </p>
      <p className="flex justify-center gap-4 underline">
        <Link href="/">Back to the demo</Link>
        <Link href="/run-locally">Run locally</Link>
      </p>
    </div>
  );
}
