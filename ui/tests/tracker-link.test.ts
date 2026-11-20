import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const runAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/claude/agent", async (original) => ({
  ...(await original<typeof import("@/lib/claude/agent")>()),
  runAgent,
}));

const fixture = fs.readFileSync(
  "tests/fixtures/applications.one-row.md",
  "utf8",
);
let root: string;

beforeEach(() => {
  vi.resetModules();
  runAgent.mockReset();
  root = fs.mkdtempSync(path.join(os.tmpdir(), "career-link-"));
  vi.stubEnv("CAREER_ROOT", root);
  vi.stubEnv("UI_FIXTURES", "0");
  fs.mkdirSync(path.join(root, "records"));
  fs.writeFileSync(
    path.join(root, "records/applications.md"),
    fixture.replace("https://acme.test/jobs/1", ""),
  );
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(root, { recursive: true, force: true });
});

async function setup() {
  const { GET } = await import("@/app/api/applications/route");
  const { POST, DELETE, PUT, PATCH } =
    await import("@/app/api/tracker/link/route");
  const {
    fileHash,
    rows: [row],
  } = await (await GET()).json();
  const request = () =>
    new Request("http://localhost/api/tracker/link", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: row.key,
        lineIndex: row.lineIndex,
        fileHash,
      }),
    });
  const send = (method: "PUT" | "PATCH", extra: object = {}) =>
    new Request("http://localhost/api/tracker/link", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: row.key,
        lineIndex: row.lineIndex,
        fileHash,
        ...extra,
      }),
    });
  return { GET, POST, DELETE, PUT, PATCH, request, send };
}

it.each(["posting", "careers", "website"])(
  "persists and removes a %s link",
  async (kind) => {
    const { GET, POST, DELETE, request } = await setup();
    const foundLink = { kind, url: "https://acme.com/jobs/1" };
    runAgent.mockResolvedValue({
      subtype: "success",
      structuredOutput: { ...foundLink, evidence: "Acme search result" },
    });
    const results = await Promise.all([POST(request()), POST(request())]);
    expect(results.map((result) => result.status)).toEqual([200, 200]);
    // A found job ends the search; anything else also runs the general-page stage.
    expect(runAgent).toHaveBeenCalledTimes(kind === "posting" ? 1 : 2);
    const {
      rows: [row],
    } = await (await GET()).json();
    expect(row).toMatchObject({ link: "", foundLink });
    expect((await DELETE(request())).status).toBe(200);
    expect((await (await GET()).json()).rows[0].foundLink).toBeUndefined();
  },
);

it.each([
  [{ kind: "none", url: null, evidence: "" }, 404],
  [
    {
      kind: "posting",
      url: "https://127.0.0.1/jobs",
      evidence: "Invalid host",
    },
    502,
  ],
  [{ kind: "website", url: "https://acme.com", evidence: "" }, 502],
] as const)(
  "handles unsuccessful output %j",
  async (structuredOutput, status) => {
    const { POST, request } = await setup();
    runAgent.mockResolvedValue({ subtype: "success", structuredOutput });
    expect((await POST(request())).status).toBe(status);
    const stored = path.join(root, "records/application-links.json");
    if (status === 404) {
      // "Nothing found" is remembered so the UI offers Retry / Paste / Dismiss.
      expect(
        Object.values(JSON.parse(fs.readFileSync(stored, "utf8")))[0],
      ).toMatchObject({
        kind: "none",
      });
    } else expect(fs.existsSync(stored)).toBe(false);
  },
);

it("rejects a stale result when an existing posting link is added during search", async () => {
  const { POST, request } = await setup();
  runAgent.mockImplementation(async () => {
    fs.writeFileSync(path.join(root, "records/applications.md"), fixture);
    return {
      subtype: "success",
      structuredOutput: {
        kind: "posting",
        url: "https://acme.com/jobs/1",
        evidence: "Acme posting",
      },
    };
  });
  expect((await POST(request())).status).toBe(409);
  const latest = await setup();
  expect((await latest.POST(latest.request())).status).toBe(409);
  expect(runAgent).toHaveBeenCalledTimes(1);
});

it("aborts the model on timeout", async () => {
  const { POST, request } = await setup();
  const { AgentError } = await import("@/lib/claude/agent");
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    runAgent.mockImplementation(
      ({ signal }: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          signal.addEventListener("abort", () =>
            reject(new AgentError("Agent timed out", "timeout")),
          );
          started();
        }),
    );
    const result = POST(request());
    await ready;
    await vi.advanceTimersByTimeAsync(180_000);
    expect((await result).status).toBe(503);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps the Tracker readable when the found-link file is corrupt", async () => {
  const file = path.join(root, "records/application-links.json");
  fs.writeFileSync(file, "{not json");
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { GET } = await import("@/app/api/applications/route");
  const response = await GET();
  expect(response.status).toBe(200);
  expect((await response.json()).rows[0].foundLink).toBeUndefined();
  // Reads never repair or overwrite the damaged file.
  expect(fs.readFileSync(file, "utf8")).toBe("{not json");
});

it("remembers a miss, lets a retry succeed, and accepts a pasted or dismissed state", async () => {
  const { GET, POST, PUT, PATCH, DELETE, request, send } = await setup();
  runAgent.mockResolvedValue({
    subtype: "success",
    structuredOutput: { kind: "none", url: null, evidence: "" },
  });
  expect((await POST(request())).status).toBe(404);
  let row = (await (await GET()).json()).rows[0];
  expect(row.foundLink).toBeUndefined();
  expect(row.linkLookup).toMatchObject({ kind: "none" });
  // Retry searches again and replaces the miss.
  runAgent.mockReset();
  runAgent.mockResolvedValue({
    subtype: "success",
    structuredOutput: {
      kind: "careers",
      url: "https://acme.com/careers",
      evidence: "Acme careers",
    },
  });
  expect((await POST(request())).status).toBe(200);
  row = (await (await GET()).json()).rows[0];
  expect(row.foundLink).toEqual({
    kind: "careers",
    url: "https://acme.com/careers",
  });
  // Pasted links must be public https; a valid one replaces the found link.
  expect((await PUT(send("PUT", { url: "http://acme.com" }))).status).toBe(400);
  expect(
    (await PUT(send("PUT", { url: "https://acme.com/jobs/7" }))).status,
  ).toBe(200);
  row = (await (await GET()).json()).rows[0];
  expect(row.foundLink).toEqual({
    kind: "manual",
    url: "https://acme.com/jobs/7",
  });
  // Dismissing never overwrites a real link; after removal it records "ignored".
  expect((await PATCH(send("PATCH"))).status).toBe(409);
  expect((await DELETE(request())).status).toBe(200);
  expect((await PATCH(send("PATCH"))).status).toBe(200);
  row = (await (await GET()).json()).rows[0];
  expect(row.linkLookup).toEqual({ kind: "ignored" });
});

it("sends the job's source and saves an aggregator page as an other-site link", async () => {
  const { GET, POST, request } = await setup();
  runAgent.mockResolvedValue({
    subtype: "success",
    structuredOutput: {
      kind: "posting",
      url: "https://getfirsthire.com/jobs/abc",
      evidence: "Listing on an aggregator",
    },
  });
  expect((await POST(request())).status).toBe(200);
  const call = runAgent.mock.calls[0][0];
  expect(call.model).toBe("gpt-6.1-terra");
  expect(call.systemPrompt).toMatch(/employer's OWN site/);
  // The aggregator is not the job itself, so the general-page stage ran too.
  expect(runAgent).toHaveBeenCalledTimes(2);
  expect(runAgent.mock.calls[1][0].systemPrompt).toMatch(/exact job could not/);
  expect(JSON.parse(call.prompt)).toMatchObject({ source: expect.any(String) });
  const {
    rows: [row],
  } = await (await GET()).json();
  expect(row.foundLink).toEqual({
    kind: "other",
    url: "https://getfirsthire.com/jobs/abc",
  });
});

it("finds the job on the source board without searching for general pages", async () => {
  const { GET, POST, request } = await setup();
  const { rows } = await (await GET()).json();
  const source = rows[0].source;
  runAgent.mockResolvedValueOnce({
    subtype: "success",
    structuredOutput: {
      kind: "source",
      url: "https://www.linkedin.com/jobs/view/123",
      evidence: "LinkedIn posting",
    },
  });
  expect((await POST(request())).status).toBe(200);
  expect(runAgent).toHaveBeenCalledTimes(1);
  const saved = (await (await GET()).json()).rows[0].foundLink;
  // The board is only "source" when it is the board this job came from.
  expect(saved.kind).toBe(source === "LinkedIn" ? "source" : "other");
});

it("re-labels a link saved before the host check, without changing its URL", async () => {
  const { GET } = await setup();
  const {
    rows: [row],
  } = await (await GET()).json();
  const { writeFoundLink, linkIdentity } = await import("@/lib/foundLinkStore");
  writeFoundLink(linkIdentity(row, [row])!, {
    kind: "posting",
    url: "https://getfirsthire.com/jobs/abc",
  });
  const after = (await (await GET()).json()).rows[0].foundLink;
  expect(after).toEqual({
    kind: "other",
    url: "https://getfirsthire.com/jobs/abc",
  });
});
