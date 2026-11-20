import { readPreferences } from "./preferences";
type JobText = { jobPost: string; originalJobPost?: string };
export function effectiveContextMode(
  request: JobText,
  format?: "brief",
): "original" | "brief" {
  // Legacy records have only one representation. Report and use the one actually available.
  if (format === "brief" && !request.originalJobPost) return "brief";
  if (format !== "brief" && !request.originalJobPost) return "original";
  return readPreferences().contextMode;
}
export function jobContext(request: JobText, format?: "brief"): string {
  return effectiveContextMode(request, format) === "original"
    ? (request.originalJobPost ?? request.jobPost)
    : request.jobPost;
}
