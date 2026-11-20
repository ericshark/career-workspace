import { seedResumes, removeTestRoot } from "./seedResumes";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NewApplication } from "@/lib/types";

// CAREER_ROOT is read when lib/paths.ts loads, so each test points it at a temp copy and imports
// the modules fresh. Nothing here can ever touch the real records/applications.md.
let root: string;
let file: string;
const fixtures = path.join(import.meta.dirname, "fixtures");

async function setup(fixture: string) {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "apps-"));
  seedResumes(root);
  file = path.join(root, "records/applications.md");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(path.join(fixtures, `applications.${fixture}.md`), file);
  process.env.CAREER_ROOT = root;
  vi.resetModules();
  const apps = await import("@/lib/applications");
  if (fixture !== "header-changed")
    fs.writeFileSync(file, apps.migrateV2ToV3(fs.readFileSync(file, "utf8")));
  const store = await import("@/lib/fileStore");
  return { apps, store };
}

afterEach(() => {
  delete process.env.CAREER_ROOT;
  removeTestRoot(root);
});

const lines = (p: string) => fs.readFileSync(p, "utf8").split("\n");

const newApp = (
  fileHash: string,
  over: Partial<NewApplication["row"]> = {},
  decision: NewApplication["decision"] = "submitted",
): NewApplication => ({
  fileHash,
  decision,
  row: {
    company: "Globex",
    role: "Backend Engineer",
    lane: "tech",
    resume: "tech",
    fit: 77,
    match: 64,
    source: "LinkedIn",
    ...over,
  },
});

describe("readApplications", () => {
  it("reads the real-format file and caches by mtime+size", async () => {
    const { apps } = await setup("one-row");
    const a = await apps.readApplications();
    expect(a.rows).toHaveLength(1);
    expect(a.fileHash).toBe(
      (await import("@/lib/fileStore")).sha256(fs.readFileSync(file, "utf8")),
    );
    expect(await apps.readApplications()).toBe(a); // same object: cache hit

    // An outside edit changes size/mtime, so the cache is rebuilt.
    fs.appendFileSync(file, "tail\n");
    const b = await apps.readApplications();
    expect(b).not.toBe(a);
    expect(b.fileHash).not.toBe(a.fileHash);
  });

  it("returns readOnly (does not throw) when the header changed", async () => {
    const { apps } = await setup("header-changed");
    const a = await apps.readApplications();
    expect(a.readOnly).toMatchObject({ reason: expect.any(String) });
  });

  it("computes the row key as sha1(date|company|role|link)", async () => {
    const { apps } = await setup("one-row");
    const [r] = (await apps.readApplications()).rows;
    expect(r.key).toBe(
      apps.rowKey({
        date: "2026-10-05",
        company: "Acme",
        role: "Software Engineer",
        link: "https://acme.test/jobs/1",
      }),
    );
    // sha1("a|b|c|d")
    expect(apps.rowKey({ date: "a", company: "b", role: "c", link: "d" })).toBe(
      createHash("sha1").update("a|b|c|d").digest("hex"),
    );
  });
});

describe("upsertApplication (insert)", () => {
  it("keeps the review record ID through later-to-applied and row edits", async () => {
    const { apps } = await setup("one-row");
    const id = "review-12345678";
    const first = await apps.upsertApplication(
      {
        ...newApp((await apps.readApplications()).fileHash, {}, "later"),
        reviewId: id,
      },
      "2026-10-06",
    );
    expect(first.rows.find((row) => row.company === "Globex")?.recordId).toBe(
      id,
    );
    const second = await apps.upsertApplication(
      { ...newApp(first.fileHash), reviewId: id },
      "2026-10-07",
    );
    const row = second.rows.find((item) => item.company === "Globex")!;
    expect(row).toMatchObject({
      recordId: id,
      status: "applied",
      date: "2026-10-07",
    });
    const edited = await apps.updateRow(
      second.fileHash,
      row.key,
      { next: "Follow up" },
      "2026-10-08",
    );
    expect(
      edited.rows.find((item) => item.company === "Globex")?.recordId,
    ).toBe(id);
  });

  it("replaces the placeholder: +1 / -1 lines, new row directly under the separator", async () => {
    const { apps } = await setup("legacy-v2");
    const before = lines(file);
    const { fileHash } = await apps.readApplications();
    const out = await apps.upsertApplication(
      newApp(fileHash, { next: "Follow up with Sam 2026-10-13" }),
      "2026-10-06",
    );
    const after = lines(file);
    const sepIdx = before.findIndex((l) => l.startsWith("|---"));
    expect(after[sepIdx + 1]).toBe(
      "| 2026-10-06 | Globex | Backend Engineer | tech | tech | 77 | 64 | LinkedIn | applied | Follow up with Sam 2026-10-13 |  |  |",
    );
    // Diff is exactly the placeholder line removed and the new line added.
    expect(after).toHaveLength(before.length);
    expect(after.filter((l) => !before.includes(l))).toHaveLength(1);
    expect(before.filter((l) => !after.includes(l))).toEqual([
      "| | | | | | | | | | | |  |",
    ]);
    expect(out.rows).toHaveLength(1);
    expect(out.fileHash).not.toBe(fileHash);
    // The read cache was invalidated by the write.
    expect((await apps.readApplications()).rows).toHaveLength(1);
  });

  it("with existing rows adds exactly one line at the top and handles `later`", async () => {
    const { apps } = await setup("one-row");
    const before = lines(file);
    const { fileHash } = await apps.readApplications();
    await apps.upsertApplication(newApp(fileHash, {}, "later"), "2026-10-06");
    const after = lines(file);
    expect(after).toHaveLength(before.length + 1);
    const sepIdx = before.findIndex((l) => l.startsWith("|---"));
    expect(after[sepIdx + 1]).toContain("| Globex |");
    expect(after[sepIdx + 1]).toContain("| to apply |");
    expect(after[sepIdx + 2]).toBe(before[sepIdx + 1]);
    expect(after.filter((l) => !before.includes(l))).toHaveLength(1);
  });

  it("escapes pipes and newlines in user input", async () => {
    const { apps } = await setup("legacy-v2");
    const { fileHash } = await apps.readApplications();
    const out = await apps.upsertApplication(
      newApp(fileHash, {
        company: "A|B",
        link: "https://x.test/?a=1|2",
        next: "line1\nline2",
      }),
      "2026-10-06",
    );
    const text = fs.readFileSync(file, "utf8");
    expect(text).toContain("| A\\|B |");
    expect(text).toContain("https://x.test/?a=1\\|2 |");
    expect(text).toContain("line1 line2");
    // And it reads back as one well-formed row with the original values.
    expect(out.malformed).toEqual([]);
    expect(out.rows[0].company).toBe("A|B");
    expect(out.rows[0].link).toBe("https://x.test/?a=1|2");
  });

  it("rejects a stale fileHash with ConflictError and leaves the file unchanged", async () => {
    const { apps, store } = await setup("legacy-v2");
    const original = fs.readFileSync(file, "utf8");
    await expect(
      apps.upsertApplication(newApp("0".repeat(64)), "2026-10-06"),
    ).rejects.toBeInstanceOf(store.ConflictError);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("rejects writes when the table format changed (read-only)", async () => {
    const { apps } = await setup("header-changed");
    const { fileHash } = await apps.readApplications();
    const original = fs.readFileSync(file, "utf8");
    await expect(
      apps.upsertApplication(newApp(fileHash), "2026-10-06"),
    ).rejects.toBeInstanceOf(apps.ReadOnlyError);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("validates input with zod", async () => {
    const { apps } = await setup("legacy-v2");
    const { fileHash } = await apps.readApplications();
    const bad: NewApplication[] = [
      newApp(fileHash, { fit: 101 }),
      newApp(fileHash, { match: -1 }),
      newApp(fileHash, { fit: 7.5 }),
      newApp(fileHash, { lane: "x" as "tech" }),
      newApp(fileHash, { company: "  " }),
    ];
    for (const b of bad)
      await expect(
        apps.upsertApplication(b, "2026-10-06"),
      ).rejects.toBeInstanceOf(apps.ValidationError);
    await expect(
      apps.upsertApplication(newApp(fileHash), "10/06/2026"),
    ).rejects.toBeInstanceOf(apps.ValidationError);
  });
});

describe("updateStatus", () => {
  it("attaches a saved record to one existing row without changing its details", async () => {
    const { apps } = await setup("one-row");
    const { rows, fileHash } = await apps.readApplications();
    const original = rows[0];
    const recordId = "review-12345678";
    const updated = await apps.attachRecordId(fileHash, original.key, recordId);
    expect(updated.rows[0]).toMatchObject({
      ...original,
      recordId,
    });
    expect(
      (await apps.attachRecordId(updated.fileHash, original.key, recordId))
        .rows[0].recordId,
    ).toBe(recordId);
    await expect(
      apps.attachRecordId(updated.fileHash, original.key, "review-87654321"),
    ).rejects.toBeInstanceOf((await import("@/lib/fileStore")).ConflictError);
  });

  it("reports a failed follow-up as a warning because the row is already saved", async () => {
    const { apps } = await setup("one-row");
    const { rows, fileHash } = await apps.readApplications();
    // The recruiting refresh after a status change reads mail-sync.json; a damaged copy makes it fail.
    fs.mkdirSync(path.join(root, "records"), { recursive: true });
    fs.writeFileSync(path.join(root, "records/mail-sync.json"), "damaged");
    const out = await apps.updateStatus(
      fileHash,
      rows[0].key,
      "in progress",
      "2026-10-06",
    );
    expect(out.rows[0].status).toBe("in progress");
    expect(out.warnings).toEqual([
      expect.stringContaining("refreshing recruiting history"),
    ]);
    expect(
      (await apps.readApplications()).rows.find((r) => r.key === rows[0].key)
        ?.status,
    ).toBe("in progress");
  });

  it("`to apply` -> `applied` changes only that line and sets the date to today", async () => {
    const { apps } = await setup("escaped");
    const before = lines(file);
    const { rows, fileHash } = await apps.readApplications();
    const target = rows[0]; // the `to apply` row from 2026-10-05
    const out = await apps.updateStatus(
      fileHash,
      target.key,
      "applied",
      "2026-10-06",
    );
    const after = lines(file);
    expect(after).toHaveLength(before.length);
    const changed = after.flatMap((l, i) => (l !== before[i] ? [i] : []));
    expect(changed).toEqual([
      before.indexOf(before.find((l) => l.includes("Foo \\| Bar"))!),
    ]);
    expect(after[changed[0]]).toBe(
      "| 2026-10-06 | Foo \\| Bar | Engineer \\| Platform | tech | tech | 70 | 71 | Other | applied |  | https://x.test/?a=1\\|2 |  |",
    );
    expect(out.rows[0].status).toBe("applied");
    expect(out.rows[0].date).toBe("2026-10-06");
  });

  it("other transitions keep the date", async () => {
    const { apps } = await setup("one-row");
    const { rows, fileHash } = await apps.readApplications();
    const out = await apps.updateStatus(
      fileHash,
      rows[0].key,
      "in progress",
      "2026-10-20",
    );
    expect(out.rows[0]).toMatchObject({
      status: "in progress",
      date: "2026-10-05",
    });
  });

  it("returns 404-style NotFoundError when no row has that key", async () => {
    const { apps } = await setup("one-row");
    const { fileHash } = await apps.readApplications();
    const original = fs.readFileSync(file, "utf8");
    await expect(
      apps.updateStatus(fileHash, "nope", "applied", "2026-10-06"),
    ).rejects.toBeInstanceOf(apps.NotFoundError);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("returns a 409-style ConflictError when two rows share the key", async () => {
    const { apps, store } = await setup("one-row");
    const text = fs.readFileSync(file, "utf8");
    const row = text.split("\n").find((l) => l.includes("| Acme |"))!;
    fs.writeFileSync(file, text.replace(row, row + "\n" + row));
    const { rows, fileHash } = await apps.readApplications();
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe(rows[1].key);
    const err = await apps
      .updateStatus(fileHash, rows[0].key, "applied", "2026-10-06")
      .catch((e) => e);
    expect(err).toBeInstanceOf(store.ConflictError);
    expect(err.message).toContain("duplicate");
  });

  it("matches exactly one row (1 -> ok) even with a malformed row in between", async () => {
    const { apps } = await setup("malformed");
    const before = fs.readFileSync(file, "utf8");
    const { rows, fileHash, malformed } = await apps.readApplications();
    const okay = rows.find((r) => r.company === "Okay Co")!;
    await apps.updateStatus(fileHash, okay.key, "applied", "2026-10-06");
    const after = fs.readFileSync(file, "utf8");
    // The malformed line survives byte-for-byte.
    expect(after).toContain(malformed[0].text);
    expect(
      lines(file).filter((l, i) => l !== before.split("\n")[i]),
    ).toHaveLength(1);
  });

  it("rejects a stale fileHash and leaves the file unchanged", async () => {
    const { apps, store } = await setup("one-row");
    const { rows } = await apps.readApplications();
    const original = fs.readFileSync(file, "utf8");
    await expect(
      apps.updateStatus("stale", rows[0].key, "applied", "2026-10-06"),
    ).rejects.toBeInstanceOf(store.ConflictError);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("rejects a bad status with ValidationError", async () => {
    const { apps } = await setup("one-row");
    const { rows, fileHash } = await apps.readApplications();
    await expect(
      apps.updateStatus(
        fileHash,
        rows[0].key,
        "maybe" as "applied",
        "2026-10-06",
      ),
    ).rejects.toBeInstanceOf(apps.ValidationError);
  });

  it("preserves CRLF and a missing trailing newline across writes", async () => {
    const { apps } = await setup("crlf");
    const { rows, fileHash } = await apps.readApplications();
    await apps.updateStatus(fileHash, rows[0].key, "in progress", "2026-10-06");
    const text = fs.readFileSync(file, "utf8");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
    expect(text).toContain("| in progress |");
  });

  it("keeps a missing trailing newline missing", async () => {
    const { apps } = await setup("no-eol");
    const { rows, fileHash } = await apps.readApplications();
    await apps.updateStatus(fileHash, rows[0].key, "in progress", "2026-10-06");
    expect(fs.readFileSync(file, "utf8").endsWith("|")).toBe(true);
  });
});

describe("updateRow (inline Next / Source edits)", () => {
  it("edits next and source, keeps the key, escapes pipes", async () => {
    const { apps } = await setup("one-row");
    const { rows, fileHash } = await apps.readApplications();
    const out = await apps.updateRow(
      fileHash,
      rows[0].key,
      { next: "Follow up | Sam 2026-10-14", source: "Hiring Cafe" },
      "2026-10-07",
    );
    expect(out.rows[0]).toMatchObject({
      next: "Follow up | Sam 2026-10-14",
      source: "Hiring Cafe",
      status: rows[0].status,
      key: rows[0].key,
    });
    expect(fs.readFileSync(file, "utf8")).toContain("Follow up \\| Sam");
  });

  it("rejects newlines and empty changes without writing", async () => {
    const { apps } = await setup("one-row");
    const { rows, fileHash } = await apps.readApplications();
    const original = fs.readFileSync(file, "utf8");
    await expect(
      apps.updateRow(fileHash, rows[0].key, { next: "a\nb" }, "2026-10-07"),
    ).rejects.toBeInstanceOf(apps.ValidationError);
    await expect(
      apps.updateRow(fileHash, rows[0].key, {}, "2026-10-07"),
    ).rejects.toBeInstanceOf(apps.ValidationError);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
  });

  it("refuses a stale file hash", async () => {
    const { apps } = await setup("one-row");
    const { rows } = await apps.readApplications();
    await expect(
      apps.updateRow("stale", rows[0].key, { source: "Indeed" }, "2026-10-07"),
    ).rejects.toThrow();
  });
});

describe("upsertApplication (saved-for-later → applied)", () => {
  const link = "https://boards.greenhouse.io/globex/jobs/42";

  it("updates the `to apply` row for the same posting instead of adding a row", async () => {
    const { apps } = await setup("one-row");
    let { fileHash } = await apps.readApplications();
    const later = await apps.upsertApplication(
      newApp(fileHash, { link }, "later"),
      "2026-10-06",
    );
    expect(later.action).toBe("inserted");
    expect(later.rows[0]).toMatchObject({
      status: "to apply",
      date: "2026-10-06",
    });
    const before = lines(file).length;

    fileHash = later.fileHash;
    // Same posting, different tracking params; tailored resume with its own Match.
    const applied = await apps.upsertApplication(
      {
        ...newApp(
          fileHash,
          {
            link: link + "?gh_src=li",
            resume: "general",
            match: 86,
          },
          "submitted",
        ),
        date: "2026-10-07",
      },
      "2026-10-08",
    );
    expect(applied.action).toBe("updated");
    expect(lines(file)).toHaveLength(before); // no new row
    expect(applied.rows).toHaveLength(2);
    expect(applied.rows[0]).toMatchObject({
      status: "applied",
      date: "2026-10-07", // the actual submit date, not "today"
      resume: "general",
      fit: "77",
      match: "86",
      link, // the original row's link is kept
    });
  });

  it("an already-applied posting gets a second row (multiple applications are allowed)", async () => {
    const { apps } = await setup("one-row");
    const { fileHash } = await apps.readApplications();
    const out = await apps.upsertApplication(
      newApp(fileHash, { link: "https://acme.test/jobs/1" }),
      "2026-10-07",
    );
    expect(out.action).toBe("inserted");
    expect(out.rows).toHaveLength(2);
  });

  it("stores a blank Match as an empty cell", async () => {
    const { apps } = await setup("legacy-v2");
    const { fileHash } = await apps.readApplications();
    const out = await apps.upsertApplication(
      newApp(fileHash, { match: null }),
      "2026-10-07",
    );
    expect(out.rows[0].match).toBe("");
  });
});

describe("updateRow (submit date, resume, scores)", () => {
  it("to apply → applied uses the given submit date", async () => {
    const { apps } = await setup("escaped");
    const { rows, fileHash } = await apps.readApplications();
    const out = await apps.updateRow(
      fileHash,
      rows[0].key,
      { status: "applied", date: "2026-10-05", match: 90 },
      "2026-10-07",
    );
    expect(out.rows[0]).toMatchObject({
      status: "applied",
      date: "2026-10-05",
      match: "90",
    });
  });

  it("ignores `date` when it isn't a to apply → applied flip", async () => {
    const { apps } = await setup("one-row");
    const { rows, fileHash } = await apps.readApplications();
    const out = await apps.updateRow(
      fileHash,
      rows[0].key,
      { status: "in progress", date: "2026-01-01" },
      "2026-10-07",
    );
    expect(out.rows[0].date).toBe("2026-10-05");
  });

  it("rejects an impossible date", async () => {
    const { apps } = await setup("escaped");
    const { rows, fileHash } = await apps.readApplications();
    await expect(
      apps.updateRow(
        fileHash,
        rows[0].key,
        { status: "applied", date: "2026-02-30" },
        "2026-10-07",
      ),
    ).rejects.toBeInstanceOf(apps.ValidationError);
  });
});

describe("migrateV1ToV2", () => {
  it("turns the real v1 file into the checked-in v2 fixture (golden)", async () => {
    const { apps } = await setup("one-row");
    const v1 = fs.readFileSync(
      path.join(fixtures, "applications.legacy-2026-10-06.md"),
      "utf8",
    );
    const v2 = fs.readFileSync(
      path.join(fixtures, "applications.legacy-v2.md"),
      "utf8",
    );
    expect(apps.migrateV1ToV2(v1)).toBe(v2);
    // Idempotent: v2 text is returned unchanged.
    expect(apps.migrateV1ToV2(v2)).toBe(v2);
  });

  it("moves Score to Fit, blanks Match, drops Lvl, keeps malformed rows and CRLF", async () => {
    const { apps } = await setup("one-row");
    const v1 = [
      "# Applications Log",
      "",
      "| Date | Company | Role | Lane | Resume | Lvl | Score | Source | Status | Next (action + date) | Link |",
      "|---|---|---|---|---|---|---|---|---|---|---|",
      "| 2026-10-07 | Brightpath | SWE I | tech | tech | 0 | 61 | Other | applied |  | https://x.test/1 |",
      "| 2026-10-06 | Bad | row |",
      "",
      "---",
      "",
      "## Outreach log (optional, one line each)",
      "",
      "| Date | Person (role) | Company | Channel | Re: application? | Reply? |",
      "|---|---|---|---|---|---|",
      "| | | | | | |",
      "",
    ].join("\r\n");
    const out = apps.migrateV1ToV2(v1);
    expect(out).toContain(
      "| 2026-10-07 | Brightpath | SWE I | tech | tech | 61 |  | Other | applied |  | https://x.test/1 |\r\n",
    );
    expect(out).toContain("| 2026-10-06 | Bad | row |");
    expect(out).not.toContain("Outreach");
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(apps.parseApplications(out).rows[0]).toMatchObject({
      fit: "61",
      match: "",
    });
  });

  it("migrates the file in place under the lock, once", async () => {
    const { apps } = await setup("legacy-2026-10-06");
    expect((await apps.readApplications()).readOnly).not.toBe(false);
    expect(await apps.migrateApplicationsFile()).toBe(true);
    expect((await apps.readApplications()).readOnly).toBe(false);
    expect(await apps.migrateApplicationsFile()).toBe(false);
  });
});

describe("deleteRow", () => {
  it("removes only that row and keeps every other line", async () => {
    const { apps } = await setup("escaped");
    const before = lines(file);
    const { rows, fileHash } = await apps.readApplications();
    const target = rows[0];
    const out = await apps.deleteRow(fileHash, target.key, target.lineIndex);
    const after = lines(file);
    const removedIndex = before.findIndex((l) => l.includes("Foo \\| Bar"));
    expect(after).toEqual(before.filter((_, i) => i !== removedIndex));
    expect(out.rows.map((r) => r.key)).not.toContain(target.key);
    expect(out.rows).toHaveLength(rows.length - 1);
  });

  it("removes the chosen one of two rows that share a key", async () => {
    const { apps } = await setup("one-row");
    // Same date/company/role/link (so the same key), blank scores: a posting logged twice.
    const scored =
      "| 2026-10-05 | Acme | Software Engineer | tech | tailored/acme-swe | 82 | 71 | LinkedIn | applied | Follow up with Jane 2026-10-12 | https://acme.test/jobs/1 |  |";
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace(
          scored,
          `${scored}\n${scored.replace("| 82 | 71 |", "|  |  |")}`,
        ),
    );
    const { rows, fileHash } = await apps.readApplications();
    expect(rows).toHaveLength(2);
    expect(rows[0].key).toBe(rows[1].key);
    const out = await apps.deleteRow(fileHash, rows[1].key, rows[1].lineIndex);
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ fit: "82", match: "71" });
  });

  it("refuses a stale hash, a missing key, or a line that holds another row", async () => {
    const { apps } = await setup("one-row");
    const { rows, fileHash } = await apps.readApplications();
    const [row] = rows;
    await expect(
      apps.deleteRow("stale", row.key, row.lineIndex),
    ).rejects.toThrow();
    await expect(
      apps.deleteRow(fileHash, "nope", row.lineIndex),
    ).rejects.toThrow(/not found/);
    await expect(
      apps.deleteRow(fileHash, row.key, row.lineIndex + 1),
    ).rejects.toThrow(/not found/);
    expect((await apps.readApplications()).rows).toHaveLength(1);
  });
});

it("marks a linked, linkless reviewed To apply row applied without inserting a duplicate", async () => {
  const { apps } = await setup("one-row");
  const id = "review-linkless-12345";
  const initial = await apps.readApplications();
  const pending = await apps.upsertApplication(
    { ...newApp(initial.fileHash, {}, "later"), reviewId: id },
    "2026-11-02",
  );
  const submitted = await apps.upsertApplication(
    { ...newApp(pending.fileHash), reviewId: id },
    "2026-11-02",
    undefined,
    {},
  );
  expect(submitted.action).toBe("updated");
  expect(submitted.rows).toHaveLength(initial.rows.length + 1);
  expect(submitted.rows[0]).toMatchObject({ recordId: id, status: "applied" });
  await expect(
    apps.upsertApplication(
      { ...newApp(submitted.fileHash), reviewId: id },
      "2026-11-02",
      undefined,
      {},
    ),
  ).rejects.toThrow(/progressed/);
});

it("preserves the original saved job association when submitting its linked review", async () => {
  const { apps } = await setup("one-row");
  const initial = await apps.readApplications();
  const sourceRecordId = "quick-original-123456";
  const saved = await apps.upsertApplication(
    newApp(initial.fileHash, { recordId: sourceRecordId }, "later"),
    "2026-11-02",
  );
  const submitted = await apps.upsertApplication(
    { ...newApp(saved.fileHash), reviewId: "review-linked-123456" },
    "2026-11-02",
    undefined,
    { sourceRecordId },
  );
  expect(submitted.action).toBe("updated");
  expect(submitted.rows).toHaveLength(initial.rows.length + 1);
  expect(submitted.rows[0]).toMatchObject({
    recordId: sourceRecordId,
    status: "applied",
  });
});

describe("Unsuccessful status", () => {
  it("maps the pure rule", async () => {
    const { storedStatus, isClosedStatus, isRejectedStatus } =
      await import("@/lib/status");
    expect(storedStatus("in progress", "rejected")).toBe("unsuccessful");
    expect(storedStatus("unsuccessful", "rejected")).toBe("unsuccessful");
    expect(storedStatus("applied", "rejected")).toBe("rejected");
    expect(storedStatus("applied", "in progress")).toBe("in progress");
    expect(isClosedStatus("Unsuccessful")).toBe(true);
    expect(isRejectedStatus("unsuccessful")).toBe(true);
    expect(isRejectedStatus("no response")).toBe(false);
  });

  it("updateRow stores a rejection of an In progress row as unsuccessful, and a plain one as rejected", async () => {
    const { apps } = await setup("one-row");
    let { rows, fileHash } = await apps.readApplications();
    const key = rows[0].key;
    await apps.updateRow(
      fileHash,
      key,
      { status: "in progress" },
      "2026-10-07",
    );
    ({ rows, fileHash } = await apps.readApplications());
    const out = await apps.updateRow(
      fileHash,
      key,
      { status: "rejected" },
      "2026-10-07",
    );
    expect(out.rows[0].status).toBe("unsuccessful");
    expect(fs.readFileSync(file, "utf8")).toContain("| unsuccessful |");

    // A row that never progressed stays a plain rejection.
    await apps.updateRow(
      out.fileHash,
      key,
      { status: "applied" },
      "2026-10-07",
    );
    ({ rows, fileHash } = await apps.readApplications());
    const plain = await apps.updateRow(
      fileHash,
      key,
      { status: "rejected" },
      "2026-10-07",
    );
    expect(plain.rows[0].status).toBe("rejected");
  });
});
