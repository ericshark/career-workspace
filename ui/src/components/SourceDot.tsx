import { sourceColor } from "@/lib/sources";

/** Small colored circle identifying a job source. */
export function SourceDot({
  source,
  size = 9,
}: {
  source: string;
  size?: number;
}) {
  if (!source.trim()) return null;
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-full"
      style={{ width: size, height: size, background: sourceColor(source) }}
    />
  );
}
