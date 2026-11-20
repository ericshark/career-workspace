import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { removeTestRoot, seedResumes } from "./seedResumes";

const runAgent = vi.hoisted(() => vi.fn());
vi.mock("@/lib/claude/agent", async (original) => ({
  ...(await original<typeof import("@/lib/claude/agent")>()),
  runAgent,
}));

let root: string;
async function setup() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "quick-route-"));
  seedResumes(root);
  fs.mkdirSync(path.join(root, "records"));
  vi.stubEnv("CAREER_ROOT", root);
  vi.stubEnv("UI_FIXTURES", "0");
  vi.resetModules();
  runAgent.mockReset();
  const { migrateV2ToV3, readApplications } =
    await import("@/lib/applications");
  fs.writeFileSync(
    path.join(root, "records/applications.md"),
    migrateV2ToV3(
      fs.readFileSync(
        path.join(import.meta.dirname, "fixtures/applications.one-row.md"),
        "utf8",
      ),
    ),
  );
  const { POST } = await import("@/app/api/quick/route");
  const { fixtureQuickBatch } = await import("@/lib/quick");
  return { POST, fixtureQuickBatch, readApplications };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  removeTestRoot(root);
});

const makeJobs = (count: number, length: number) =>
  Array.from({ length: count }, (_, index) => ({
    submissionId: `quick-card-${index + 1}`,
    description: `Employer ${index + 1} — Engineer\n${"Build and test services. ".repeat(Math.floor(length / 25))}`,
  }));

const request = (jobs: ReturnType<typeof makeJobs>) =>
  new Request("http://localhost/api/quick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobs, provider: "openai" }),
  });

function jobsInPrompt(prompt: string) {
  return [
    ...prompt.matchAll(
      /<job number="\d+">\nJob \d+\nURL: none\nDescription:\n([\s\S]*?)\n<\/job>/g,
    ),
  ].map(([, description]) => ({ description }));
}

it.each([
  [50, 3900],
  [6, 100],
  [3, 8000],
])(
  "saves all %i cards when an oversized extraction would time out",
  { timeout: 20_000 },
  async (count, length) => {
    const { POST, fixtureQuickBatch, readApplications } = await setup();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const firstCall = Promise.withResolvers<void>();
    runAgent.mockImplementation(async ({ prompt, signal }) => {
      firstCall.resolve();
      const jobs = jobsInPrompt(prompt);
      if (
        jobs.length > 5 ||
        jobs.reduce((size, job) => size + job.description.length, 0) > 20_000
      ) {
        await new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          }),
        );
      }
      return {
        subtype: "success",
        structuredOutput: { jobs: fixtureQuickBatch(jobs) },
      };
    });

    const jobs = makeJobs(count, length);
    const response = POST(request(jobs));
    await firstCall.promise;
    await vi.advanceTimersByTimeAsync(120_000);
    const result = await response;
    const body = await result.json();
    expect(result.status, JSON.stringify(body)).toBe(201);
    expect(body.remaining).toEqual([]);
    expect(
      body.added.map((entry: { job: number; company: string }) => [
        entry.job,
        entry.company,
      ]),
    ).toEqual(jobs.map((_, index) => [index + 1, `Employer ${index + 1}`]));
    const rows = (await readApplications()).rows;
    expect(
      rows.filter((row) =>
        jobs.some((job) => job.submissionId === row.recordId),
      ),
    ).toHaveLength(count);
    expect(runAgent).toHaveBeenCalledTimes(
      Math.ceil(count / (length === 8000 ? 2 : 5)),
    );

    const { POST: undo } = await import("@/app/api/applications/undo/route");
    const undone = await undo(
      new Request("http://localhost/api/applications/undo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          undoIds: body.added.map((entry: { undoId: string }) => entry.undoId),
        }),
      }),
    );
    expect(undone.status).toBe(200);
    expect(await undone.json()).toEqual({ ok: true, undone: count, failed: 0 });
    expect((await readApplications()).rows).toHaveLength(1);
  },
);

it("rejects a batch with more than 50 jobs before calling the model", async () => {
  const { POST } = await setup();
  expect((await POST(request(makeJobs(51, 100)))).status).toBe(400);
  expect(runAgent).not.toHaveBeenCalled();
});

it("keeps earlier saves and their undo window when a later group times out", async () => {
  const { POST, fixtureQuickBatch, readApplications } = await setup();
  const { undoLog } = await import("@/lib/undo");
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
  const secondCall = Promise.withResolvers<void>();
  const successfulExtraction = ({ prompt }: { prompt: string }) => ({
    subtype: "success",
    structuredOutput: { jobs: fixtureQuickBatch(jobsInPrompt(prompt)) },
  });
  runAgent
    .mockImplementation(successfulExtraction)
    .mockImplementationOnce(successfulExtraction)
    .mockImplementationOnce(async ({ signal }) => {
      secondCall.resolve();
      await new Promise((_, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        }),
      );
    });

  const jobs = makeJobs(9, 100);
  const partial = POST(request(jobs));
  await secondCall.promise;
  const firstSaved = (await readApplications()).rows.filter((row) =>
    jobs.some((job) => job.submissionId === row.recordId),
  );
  expect(firstSaved).toHaveLength(5);
  await vi.advanceTimersByTimeAsync(120_000);

  const partialResponse = await partial;
  expect(partialResponse.status).toBe(201);
  const result = await partialResponse.json();
  expect(result.error).toBe("Agent timed out");
  expect(result.remaining).toEqual([6, 7, 8, 9]);
  expect(result.added.map((entry: { job: number }) => entry.job)).toEqual([
    1, 2, 3, 4, 5,
  ]);
  expect(runAgent).toHaveBeenCalledTimes(2);

  const retried = await POST(request(jobs));
  expect(retried.status).toBe(201);
  expect((await retried.json()).added).toHaveLength(9);
  // The first five IDs were recovered from disk, so only the remaining group went to the model.
  expect(runAgent).toHaveBeenCalledTimes(3);
  expect(
    (await readApplications()).rows.filter((row) =>
      jobs.some((job) => job.submissionId === row.recordId),
    ),
  ).toHaveLength(9);
  await vi.advanceTimersByTimeAsync(10_000);
  await expect(undoLog(result.added[0].undoId)).resolves.toBeUndefined();
});

it("processes concurrent batches in FIFO order and exposes status and control endpoints", async () => {
  const { POST, fixtureQuickBatch, readApplications } = await setup();
  const { GET: getStatus } = await import("@/app/api/quick/status/route");
  const { POST: postControl } = await import("@/app/api/quick/control/route");

  const gate1 = Promise.withResolvers<void>();
  const started1 = Promise.withResolvers<void>();
  let callOrder: string[] = [];

  runAgent.mockImplementation(async ({ prompt }) => {
    const jobs = jobsInPrompt(prompt);
    const firstLine = jobs[0]?.description.split("\n")[0] ?? "";
    callOrder.push(firstLine);
    if (firstLine.includes("BatchA")) {
      started1.resolve();
      await gate1.promise;
    }
    return {
      subtype: "success",
      structuredOutput: { jobs: fixtureQuickBatch(jobs) },
    };
  });

  const batchA = [
    {
      submissionId: "batch-a-1",
      description: "BatchA — Engineer\nBuild and test services every day.",
    },
  ];
  const batchB = [
    {
      submissionId: "batch-b-1",
      description: "BatchB — Engineer\nBuild and test services every day.",
    },
  ];

  const reqA = POST(
    new Request("http://localhost/api/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batchId: "batch-id-aaa",
        jobs: batchA,
        source: "LinkedIn",
        provider: "openai",
      }),
    }),
  );
  await started1.promise;

  const reqB = POST(
    new Request("http://localhost/api/quick", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        batchId: "batch-id-bbb",
        jobs: batchB,
        source: "Simplify",
        provider: "openai",
      }),
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));

  const midStatus = await (
    await getStatus(new Request("http://127.0.0.1/api/quick/status"))
  ).json();
  expect(midStatus.runningCount).toBe(2);
  // The polled list never carries pasted job text; one batch is read in full on demand.
  for (const batch of midStatus.batches) {
    expect(batch).not.toHaveProperty("jobs");
    expect(Array.isArray(batch.jobLinks)).toBe(true);
  }
  const detail = await (
    await getStatus(
      new Request("http://127.0.0.1/api/quick/status?batchId=batch-id-aaa"),
    )
  ).json();
  expect(detail.batch.jobs.length).toBeGreaterThan(0);
  expect(
    (
      await getStatus(
        new Request("http://127.0.0.1/api/quick/status?batchId=missing-batch"),
      )
    ).status,
  ).toBe(404);
  expect(
    midStatus.batches.find((b: any) => b.batchId === "batch-id-aaa").status,
  ).toBe("running");
  expect(
    midStatus.batches.find((b: any) => b.batchId === "batch-id-bbb").status,
  ).toBe("queued");

  gate1.resolve();
  const [resA, resB] = await Promise.all([reqA, reqB]);
  expect(resA.status).toBe(201);
  expect(resB.status).toBe(201);
  expect(callOrder).toEqual(["BatchA — Engineer", "BatchB — Engineer"]);

  const rows = (await readApplications()).rows;
  expect(rows.find((r) => r.company === "BatchA")?.source).toBe("LinkedIn");
  expect(rows.find((r) => r.company === "BatchB")?.source).toBe("Simplify");

  const finalStatus = await (
    await postControl(
      new Request("http://localhost/api/quick/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "mark-undone",
          batchId: "batch-id-bbb",
        }),
      }),
    )
  ).json();
  expect(
    finalStatus.batches.find((b: any) => b.batchId === "batch-id-bbb").undone,
  ).toBe(true);
});
