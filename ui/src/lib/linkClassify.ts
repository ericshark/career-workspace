// Decides what kind of link a found URL really is, from its host, instead of trusting the model's
// own label. A job-aggregator page (Get First Hire, Lensa, ...) must never be saved as "the job
// posting"; only the employer's own site or applicant system counts as that.
import { sourceFromLink } from "./sources";
import type { FoundLink } from "./foundLink";

// Job boards and aggregators: they host postings but are never the employer's own site. Applicant
// tracking systems (Greenhouse, Lever, Workday, Ashby, ...) are deliberately absent: those pages are
// the employer's own application page.
const BOARD_HOSTS = new Set([
  "linkedin.com",
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "simplyhired.com",
  "monster.com",
  "jooble.org",
  "talent.com",
  "getfirsthire.com",
  "lensa.com",
  "movojobs.com",
  "launchyournextchapter.com",
  "dice.com",
  "careerbuilder.com",
  "snagajob.com",
  "adzuna.com",
  "learn4good.com",
  "jobgether.com",
  "wayup.com",
  "welcometothejungle.com",
  "themuse.com",
  "jobot.com",
  "careerjet.com",
  "whatjobs.com",
  "joblist.com",
  "ladders.com",
  "flexjobs.com",
  "remoteok.com",
  "weworkremotely.com",
  "remotive.com",
  "otta.com",
  "jobleads.com",
  "jobcase.com",
  "hiringcafe.com",
  "zippia.com",
  "talentify.io",
  "jobilize.com",
  "jobrapido.com",
  "recruit.net",
]);

/** True when the host is a listed board/aggregator or one of its subdomains. */
function isListedBoard(host: string) {
  const parts = host.split(".");
  for (let i = 0; i < parts.length - 1; i++)
    if (BOARD_HOSTS.has(parts.slice(i).join("."))) return true;
  return false;
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function isJobBoardUrl(url: string): boolean {
  const host = hostOf(url);
  return !!host && (isListedBoard(host) || !!sourceFromLink(url));
}

/**
 * The kind a found URL should be saved as. The model proposes one; the host settles it:
 * - the posting on the board the job came from is "source" (e.g. the LinkedIn posting for a LinkedIn job);
 * - any other board or aggregator is "other", whatever the model called it;
 * - a "source" claim on a page that is not on a job board is really the employer's own page.
 */
export function classifyFoundLink(
  proposed: FoundLink["kind"],
  url: string,
  source: string,
): FoundLink["kind"] {
  const board = isJobBoardUrl(url);
  const fromSource =
    !!source && sourceFromLink(url)?.toLowerCase() === source.toLowerCase();
  if (proposed === "manual") return "manual";
  if (board) return fromSource ? "source" : "other";
  if (proposed === "source" || proposed === "other") return "posting";
  return proposed;
}
