// How the Guide page is organized: a fixed "I want…" flow, most likely need first, each item jumping
// to a file (and a section in it). Files the flow doesn't use are folded under "Reference"; hidden
// files redirect to the screen that shows them. Paths are relative to the career root.

/**
 * Markdown the docs browser may read: Markdown under profile/, guide/ or records/.
 * Pure so the client link rewriter and the server reader share one allowlist.
 */
export const DOC_PATH_RE = /^((profile|guide|records)\/[^\0]+\.md)$/;
export const DOC_ROOTS = ["profile", "guide", "records"];

export interface GuideItem {
  label: string; // what the workspace owner wants, in his words
  description: string; // what he'll find there, shown under the label
  path: string;
  /** Start of an h2/h3 heading to jump to; matched loosely (lib/headings findHeadingId). */
  heading?: string;
}

export interface GuideGroup {
  title: string;
  items: GuideItem[];
}

export const GUIDE_FLOW: GuideGroup[] = [
  {
    title: "Right now",
    items: [
      {
        label: "I'm stuck, anxious, or behind",
        description: "Breathe, zoom out, and take one small next step",
        path: "guide/mindset.md",
      },
      {
        label: "Growing on X",
        description:
          "How small accounts grow, the daily block, and what to post next",
        path: "guide/presence.md",
      },
      {
        label: "Things to learn",
        description: "What to learn next, in order, and what to skip for now",
        path: "guide/learning.md",
      },
    ],
  },
  {
    title: "Building",
    items: [
      {
        label: "Idea workshop",
        description: "Find a direction and generate an idea from scratch",
        path: "guide/idea-workshop.md",
      },
    ],
  },
  {
    title: "Interview coming up",
    items: [
      {
        label: "Interview prep",
        description: "What to do when you get an invite and how to practice",
        path: "guide/interview.md",
      },
    ],
  },
];

/** Hidden from the Guide page; visiting one redirects to the screen that shows it. */
export const HIDDEN_DOCS: Record<string, string> = {
  "records/applications.md": "/tracker",
};

const TITLES: Record<string, string> = {
  "guide/mindset.md": "Mindset",
  "guide/interview.md": "Interview prep",
  "guide/idea-workshop.md": "Idea workshop",
  "guide/presence.md": "Growing on X",
  "guide/learning.md": "Things to learn",
  "profile/career.md": "Career facts",
};

/** Display title: the configured one, else the file name without .md. */
export function docTitle(path: string): string {
  return TITLES[path] ?? (path.split("/").pop() ?? path).replace(/\.md$/, "");
}

/** True when a Guide flow item points at this file (it then stays out of "Reference"). */
export function isInFlow(path: string): boolean {
  return GUIDE_FLOW.some((g) => g.items.some((i) => i.path === path));
}
