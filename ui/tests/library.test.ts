import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-library-"));
  vi.stubEnv("CAREER_ROOT", root);
  vi.resetModules();
});
afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});
const load = () => import("@/app/api/library/route");
const url = "http://localhost/api/library";
const json = (method: string, body: unknown) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
async function upload(name: string, bytes: BlobPart, origin = "localhost") {
  const { POST } = await load();
  const form = new FormData();
  form.set("file", new File([bytes], name));
  const encoded = new Request(url, { method: "POST", body: form });
  const body = await encoded.arrayBuffer();
  return POST(
    new Request(url, {
      method: "POST",
      headers: {
        "content-type": encoded.headers.get("content-type")!,
        "content-length": String(body.byteLength),
        origin: `http://${origin}`,
        host: "localhost",
      },
      body,
    }),
  );
}

it("creates, edits, lists and deletes a note", async () => {
  const { GET, POST, PATCH, DELETE } = await load();
  const made = await POST(json("POST", { title: "Plan", content: "one" }));
  expect(made.status).toBe(201);
  const { id } = await made.json();
  await PATCH(json("PATCH", { id, title: "Plan 2", content: "two" }));
  expect(
    await (await GET(new Request(`${url}?id=${id}`))).json(),
  ).toMatchObject({ title: "Plan 2", content: "two", kind: "note" });
  expect(await (await GET(new Request(url))).json()).toHaveLength(1);
  expect((await DELETE(json("DELETE", { id }))).status).toBe(204);
  expect(await (await GET(new Request(url))).json()).toEqual([]);
});

it("imports text and PDFs and refuses bad files and other origins", async () => {
  expect((await upload("a.txt", "hello")).status).toBe(201);
  expect((await upload("a.pdf", "%PDF-1.4")).status).toBe(201);
  expect((await upload("fake.pdf", "nope")).status).toBe(400);
  expect((await upload("a.exe", "x")).status).toBe(400);
  expect((await upload("a.md", "")).status).toBe(400);
  expect((await upload("a.md", "x".repeat(1024 * 1024 + 1))).status).toBe(400);
  expect((await upload("a.txt", "x", "evil.example")).status).toBe(403);
});

it("rejects IDs that are not document IDs", async () => {
  const { GET, DELETE } = await load();
  expect((await GET(new Request(`${url}?id=../records`))).status).toBe(400);
  expect((await DELETE(json("DELETE", { id: "../records" }))).status).toBe(400);
  expect(fs.existsSync(path.join(root, ".documents"))).toBe(false);
});
