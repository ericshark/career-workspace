/**
 * Small tinted chip naming what kind of action or update a card is. It sits inline at the
 * end of the title and shares its text baseline (no vertical-align tricks), so it lines up with
 * the title text. "md" is for the larger Actions page text.
 */
export function CategoryChip({
  label,
  color,
  size = "sm",
}: {
  label: string;
  color: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      data-category-chip
      className={`ml-2 inline-flex shrink-0 items-center rounded-md font-medium leading-none whitespace-nowrap ${
        size === "md"
          ? "h-[18px] px-2 text-xs align-[1px]"
          : "h-4 px-1.5 text-[10px] align-[2px]"
      }`}
      // A clear wash of the category color with text tinted toward it (mixed with the foreground
      // so it stays readable in light and dark mode).
      style={{
        background: `color-mix(in oklch, ${color} 16%, transparent)`,
        color: `color-mix(in oklch, ${color} 65%, var(--foreground))`,
      }}
    >
      {label}
    </span>
  );
}

/** Visible divider between the items of a card's gray detail line. */
export function MetaSep() {
  return (
    <span aria-hidden="true" className="mx-1.5 text-muted-foreground/50">
      |
    </span>
  );
}

/** "N new" pill in the style of the Last check pill: neutral wash with a green dot. */
export function NewPill({ count, label }: { count: number; label: string }) {
  if (count <= 0) return null;
  return (
    <span
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-muted-foreground dark:bg-neutral-800"
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
      {count} new
    </span>
  );
}
