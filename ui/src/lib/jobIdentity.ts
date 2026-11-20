export type JobIdentityField = "company" | "role";

export function isMissingJobIdentity(value: string): boolean {
  return /^(?:unknown(?: (?:company|job(?: title| role)?|role|title))?|n\/?a|not (?:stated|named|specified|listed|provided|disclosed)\b.*)?$/i.test(
    value.trim(),
  );
}
