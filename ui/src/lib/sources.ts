// Job sources: the dropdown order (the workspace owner's own order of the boards he uses) and a fixed, muted color
// per source, so a source is recognizable at a glance in the tracker. Pure (no node APIs). Other
// always comes last. Rows logged with a source no longer listed keep it (hashed color, see below).

export const SOURCES = [
  "Simplify",
  "Jobright",
  "LinkedIn",
  "Handshake",
  "RippleMatch",
  "YC",
  "Wellfound",
  "Built In NYC",
  "Indeed",
  "HiringCafe",
  "Other",
] as const;

// One clearly different hue per board (teal, green, blue, gold, violet, orange, red, brown, purple,
// pink, grey), so no two are easily mistaken for each other in the Tracker.
export const SOURCE_COLOR: Record<(typeof SOURCES)[number], string> = {
  Simplify: "#06a08a",
  Jobright: "#55a02a",
  LinkedIn: "#2b78d6",
  Handshake: "#c99a06",
  RippleMatch: "#6b45e6",
  YC: "#ea6a12",
  Wellfound: "#cc2f3f",
  "Built In NYC": "#8a5a33",
  Indeed: "#b23fc4",
  HiringCafe: "#ef5fa7",
  Other: "#80848f",
};

// Fallback palette for hand-typed sources that aren't in the list.
const EXTRA = [
  "#4f9fb0",
  "#7270c9",
  "#c27a4a",
  "#3f9a8c",
  "#b8618a",
  "#7c9a4a",
];

// Older applications may still use the board's former name.
const LEGACY_NAMES: Record<string, (typeof SOURCES)[number]> = {
  "yc work at a startup": "YC",
};

/** Color for a source: the fixed one when known (case-insensitive), else stable-hashed from the name. */
export function sourceColor(name: string): string {
  // Older applications may use the spaced name for the same board.
  if (name.trim().toLowerCase() === "hiring cafe")
    return SOURCE_COLOR.HiringCafe;
  const known =
    SOURCES.find((s) => s.toLowerCase() === name.trim().toLowerCase()) ??
    LEGACY_NAMES[name.trim().toLowerCase()];
  if (known) return SOURCE_COLOR[known];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EXTRA[h % EXTRA.length];
}

/** Where each source's postings live, so a search can be limited to it (e.g. `site:linkedin.com/jobs`). */
export const SOURCE_SITE: Record<(typeof SOURCES)[number], string | null> = {
  Simplify: "simplify.jobs",
  Jobright: "jobright.ai",
  LinkedIn: "linkedin.com/jobs",
  Handshake: "joinhandshake.com",
  RippleMatch: "ripplematch.com",
  YC: "workatastartup.com",
  Wellfound: "wellfound.com",
  "Built In NYC": "builtinnyc.com",
  Indeed: "indeed.com",
  HiringCafe: "hiring.cafe",
  Other: null,
};

/** The site to search for a source's posting, or undefined when the source has no single site. */
export function sourceSite(name: string): string | undefined {
  const known =
    SOURCES.find((s) => s.toLowerCase() === name.trim().toLowerCase()) ??
    LEGACY_NAMES[name.trim().toLowerCase()];
  return (known && SOURCE_SITE[known]) || undefined;
}

// Job-board hosts → source. ATS hosts (greenhouse, lever, workday, …) are deliberately absent:
// those links are reached from many boards, so the source can't be inferred from them.
const SOURCE_HOSTS: [RegExp, (typeof SOURCES)[number]][] = [
  [/(^|\.)simplify\.jobs$/, "Simplify"],
  [/(^|\.)jobright\.ai$/, "Jobright"],
  [/(^|\.)linkedin\.com$/, "LinkedIn"],
  [/(^|\.)joinhandshake\.com$/, "Handshake"],
  [/(^|\.)ripplematch\.com$/, "RippleMatch"],
  [/(^|\.)workatastartup\.com$/, "YC"],
  [/(^|\.)(wellfound\.com|angel\.co)$/, "Wellfound"],
  [/(^|\.)builtin(nyc)?\.com$/, "Built In NYC"],
  [/(^|\.)indeed\.com$/, "Indeed"],
  [/(^|\.)hiring\.cafe$/, "HiringCafe"],
];

/** The job board a posting link belongs to, or null when the host doesn't identify one. */
export function sourceFromLink(link: string): (typeof SOURCES)[number] | null {
  const raw = link.trim();
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname
      .toLowerCase()
      .replace(/^www\./, "");
  } catch {
    return null;
  }
  return SOURCE_HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
}
