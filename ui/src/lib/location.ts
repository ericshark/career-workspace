/** Display only explicit places and arrangements; never infer attendance from a city. */
export function conciseLocation(location: string, mode = ""): string {
  const text = location
    .replace(
      /\b(?:regional and office expectations may vary|office expectations may vary|multiple locations)\b[^;.]*/gi,
      "",
    )
    .trim();
  const modeText = text.replace(
    /\b(?:not|no)\s+(?:fully\s+)?(?:remote|hybrid|on[- ]site|in[- ]office)\b/gi,
    "",
  );
  const arrangement =
    /\bflexible\b/i.test(modeText) &&
    (/work|arrangement|location|office/i.test(modeText) ||
      /^flexible$/i.test(modeText))
      ? "Flexible"
      : /\bhybrid\b/i.test(modeText)
        ? "Hybrid"
        : /\bremote\b/i.test(modeText) &&
            !/\b(?:not|no)\s+(?:fully\s+)?remote\b/i.test(text)
          ? "Remote"
          : /\b(on[- ]site|in[- ]person|in[- ]office)\b/i.test(modeText)
            ? "In person"
            : (
                {
                  remote: "Remote",
                  hybrid: "Hybrid",
                  onsite: "In person",
                  flexible: "Flexible",
                } as Record<string, string>
              )[mode.toLowerCase()] || "";
  const parts = text
    .split(
      /;|\s*[|·/]\s*|\s+or\s+|\s+and\s+|,\s*(?=[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*(?:,|$))/,
    )
    .map((s) => s.trim())
    .filter(Boolean);
  const borough = text.match(
    /\b(Manhattan|Brooklyn|Queens|Bronx|Staten Island)\b/i,
  )?.[0];
  const jersey = text.match(
    /\b([A-Z][a-z]+(?: [A-Z][a-z]+)*),?\s+(?:NJ|New Jersey)\b/,
  )?.[0];
  const ny = parts.find((s) =>
    /\b(New York|NYC|Manhattan|Brooklyn|Queens|Bronx|Staten Island)\b/i.test(s),
  );
  let place = (
    borough ||
    ny ||
    jersey ||
    parts.find(
      (s) =>
        !/^(remote|hybrid|on[- ]site|in[- ]person|in[- ]office|flexible)$/i.test(
          s,
        ),
    ) ||
    ""
  )
    .replace(
      /\(?\b(remote|hybrid|on[- ]site|in[- ]person|in[- ]office|flexible(?:\s+(?:work\s+)?(?:arrangement|location))?)\b\)?/gi,
      "",
    )
    .replace(/^[\s,·:-]+|[\s,·:-]+$/g, "");
  place = place
    .replace(/\bNew York(?: City)?(?:,\s*(?:NY|New York))?\b/gi, "New York")
    .replace(/\bNYC\b/gi, "New York");
  place = place.replace(/\bnot\s+(?:fully\s+)?$/i, "").trim();
  if (/^(unknown|not stated|regional)$/i.test(place)) place = "";
  return (
    (arrangement === "Remote" ? [arrangement, place] : [place, arrangement])
      .filter(Boolean)
      .join(" · ") || "Unknown"
  );
}
