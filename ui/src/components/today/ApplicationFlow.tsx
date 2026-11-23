import { OUTCOMES, type OutcomeCounts } from "@/lib/analytics";

// Geometry in SVG units. Vertical units equal CSS pixels so the HTML labels can
// sit at each ribbon's midpoint; the width stretches to the container.
const SOURCE_HEIGHT = 110;
const TOP = 8;
// Every ribbon ends at the same edge; labels sit in one column beside them,
// at least this far apart so neighboring statuses never crowd each other.
const LABEL_SPACING = 32;
const WIDTH = 1000;
const END = WIDTH - 8;

const percent = (count: number, total: number) =>
  `${total ? ((count / total) * 100).toFixed(1) : "0"}%`;

export function ApplicationFlow({
  total,
  counts,
}: {
  total: number;
  counts: OutcomeCounts;
}) {
  const outcomes = OUTCOMES.filter(
    (o) => o.key !== "other" || counts.other > 0,
  );
  const visible = outcomes.filter((o) => counts[o.key] > 0);
  let offset = 0;
  let previousBottom = TOP - 6;
  let previousMiddle = -Infinity;
  const branches = visible.map((item) => {
    const thickness = (counts[item.key] / total) * SOURCE_HEIGHT;
    const sy = TOP + offset;
    offset += thickness;
    const middle = Math.max(
      TOP + thickness / 2,
      previousMiddle + LABEL_SPACING,
      previousBottom + 6 + thickness / 2,
    );
    const ty = middle - thickness / 2;
    previousBottom = ty + thickness;
    previousMiddle = middle;
    return { item, thickness, sy, ty, middle };
  });
  const height = Math.ceil(
    Math.max(TOP + SOURCE_HEIGHT, previousBottom, previousMiddle + 14) + 4,
  );
  return (
    <div>
      {total > 0 ? (
        <div
          className="hidden gap-3 sm:flex"
          role="img"
          aria-label={`Current status flow for ${total} submitted applications`}
          aria-description={outcomes
            .map(
              (item) =>
                `${item.label}: ${counts[item.key]} (${percent(counts[item.key], total)})`,
            )
            .join("; ")}
        >
          <svg
            viewBox={`0 0 ${WIDTH} ${height}`}
            preserveAspectRatio="none"
            className="min-w-0 flex-1"
            style={{ height }}
            aria-hidden
          >
            <rect
              x="0"
              y={TOP}
              width="10"
              height={SOURCE_HEIGHT}
              rx="2"
              fill="var(--chart-1)"
            />
            {branches.map(({ item, thickness, sy, ty }) => {
              const end = END - 7;
              const bend = (10 + end) / 2;
              return (
                <g key={item.key}>
                  <path
                    d={`M 10 ${sy} C ${bend} ${sy}, ${bend} ${ty}, ${end} ${ty} L ${end} ${ty + thickness} C ${bend} ${ty + thickness}, ${bend} ${sy + thickness}, 10 ${sy + thickness} Z`}
                    fill={item.color}
                    opacity="0.3"
                  />
                  <rect
                    x={end}
                    y={ty}
                    width="7"
                    height={Math.max(thickness, 1.5)}
                    fill={item.color}
                  />
                </g>
              );
            })}
          </svg>
          <div className="relative w-52 shrink-0" style={{ height }}>
            {branches.map(({ item, middle }) => (
              <p
                key={item.key}
                className="absolute inset-x-0 flex -translate-y-1/2 items-baseline gap-1.5 whitespace-nowrap"
                style={{ top: middle }}
                title={`${item.label}: ${counts[item.key]}`}
              >
                <span className="font-mono text-base leading-5 font-semibold tabular-nums">
                  {counts[item.key]}
                </span>
                <span className="text-xs text-muted-foreground">
                  {item.label}
                </span>
                <span className="font-mono text-xs tabular-nums">
                  {percent(counts[item.key], total)}
                </span>
              </p>
            ))}
          </div>
        </div>
      ) : (
        <p className="py-6 text-center text-sm text-muted-foreground">
          No submitted applications for this site.
        </p>
      )}
      <div className="space-y-3 py-2 sm:hidden">
        {outcomes.map((o) => (
          <div key={o.key}>
            <div className="mb-1.5 flex justify-between text-xs">
              <span>{o.label}</span>
              <span>
                {percent(counts[o.key], total)} · {counts[o.key]}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${total ? (counts[o.key] / total) * 100 : 0}%`,
                  background: o.color,
                }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
