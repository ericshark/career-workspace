import { Avatar, AvatarFallback } from "@/components/ui/avatar";

// Company initial on a soft tint picked from the name, so the same company always gets the same color.
const HUES = [
  "var(--chart-1)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-3)",
  "var(--chart-2)",
];

export function CompanyAvatar({
  name,
  size = 36,
  color,
}: {
  name: string;
  size?: number;
  /** Overrides the name-derived tint, e.g. the job's source color in the Tracker. */
  color?: string;
}) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const hue = color ?? HUES[h % HUES.length];
  const letter = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <Avatar
      aria-hidden
      className="rounded-[28%] after:rounded-[28%]"
      style={{ width: size, height: size }}
    >
      <AvatarFallback
        className="rounded-[28%] font-semibold"
        style={{
          // A given color is nudged toward the text color so the letter stays readable in both themes.
          color: color
            ? `color-mix(in oklab, ${hue} 82%, var(--foreground))`
            : hue,
          background: `color-mix(in oklch, ${hue} ${color ? 18 : 14}%, transparent)`,
          fontSize: size * 0.42,
        }}
      >
        {letter}
      </AvatarFallback>
    </Avatar>
  );
}
