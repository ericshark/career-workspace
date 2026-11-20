/** Numeric compensation only; never infer a pay period or amount. */
export function salaryLabel(text = ""): string {
  const number = "(?:[$€£]\\s*)?\\d[\\d,]*(?:\\.\\d+)?\\s*[kK]?";
  text = text.split(/\b(?:benefits|insurance|401\s*\(?k\)?)\b/i)[0];
  const match = text.match(
    new RegExp(`(${number})(?:\\s*(?:–|—|-|to)\\s*(${number}))?`, "i"),
  );
  if (!match) return "";
  const unit =
    text.match(
      /(?:per\s+|\/)(hour|hr|year|yr|annum)\b|\b(hourly|annually|annual)\b/i,
    )?.[0] ?? "";
  return `${match[0].trim()}${unit ? (/hour|hr/i.test(unit) ? "/hour" : "/year") : ""}`;
}
