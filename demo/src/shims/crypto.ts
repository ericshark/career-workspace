import { sha1 } from "@noble/hashes/sha1";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";

export const randomUUID = () => globalThis.crypto.randomUUID();
export function randomBytes(n: number) {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(n));
  return { toString: (_encoding?: string) => bytesToHex(bytes) };
}
export function createHash(name: string) {
  let text = "";
  const hash = {
    update(value: unknown, _encoding?: string) {
      text += String(value);
      return hash;
    },
    digest: (_encoding?: string) =>
      bytesToHex((name === "sha1" ? sha1 : sha256)(utf8ToBytes(text))),
  };
  return hash;
}
