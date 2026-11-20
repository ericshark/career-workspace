import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  isPlaceholderRow,
  joinTable,
  parseRow,
  serializeRow,
  splitTable,
} from "@/lib/markdown/table";
import { parseApplications } from "@/lib/applications";
import {
  APPLICATIONS_HEADER,
  APPLICATIONS_HEADER_V1,
  APPLICATIONS_HEADER_V2,
} from "@/lib/types";

// Still used by the round-trip test: v1 fixtures and the leftover outreach tables must survive untouched.
const OUTREACH_HEADER =
  "| Date | Person (role) | Company | Channel | Re: application? | Reply? |";

const dir = path.join(import.meta.dirname, "fixtures");
const names = fs
  .readdirSync(dir)
  .filter((n) => n.startsWith("applications.") && n.endsWith(".md"));
const read = (n: string) =>
  fs.readFileSync(path.join(dir, `applications.${n}.md`), "utf8");

describe("round trip", () => {
  it("has all the fixtures", () => {
    expect(names.length).toBeGreaterThanOrEqual(8);
  });

  for (const n of names) {
    it(`is byte-identical for ${n}`, () => {
      const text = fs.readFileSync(path.join(dir, n), "utf8");
      for (const header of [
        APPLICATIONS_HEADER,
        APPLICATIONS_HEADER_V2,
        APPLICATIONS_HEADER_V1,
        OUTREACH_HEADER,
      ]) {
        expect(joinTable(splitTable(text, header))).toBe(text);
      }
    });
  }

  it("is identical for a header with no table at all", () => {
    const t = splitTable("just text\nno table\n", APPLICATIONS_HEADER);
    expect(t.found).toBe(false);
    expect(joinTable(t)).toBe("just text\nno table\n");
  });

  it("handles a table that ends the file right after the separator", () => {
    const text = `${APPLICATIONS_HEADER}\n|---|---|`;
    const t = splitTable(text, APPLICATIONS_HEADER);
    expect(t.found).toBe(true);
    expect(t.body).toEqual([]);
    expect(joinTable(t)).toBe(text);
  });
});

describe("real file, migrated to v2", () => {
  const text = read("legacy-v2");

  it("splits into prefix / header / separator / placeholder / suffix", () => {
    const t = splitTable(text, APPLICATIONS_HEADER_V2);
    expect(t.found).toBe(true);
    expect(t.header).toBe(APPLICATIONS_HEADER_V2);
    expect(t.prefix.startsWith("# Synthetic applications")).toBe(true);
    expect(t.body).toHaveLength(1);
    expect(isPlaceholderRow(parseRow(t.body[0])!)).toBe(true);
    expect(t.suffix).not.toContain("Outreach");
  });

  it("has 0 rows and a detected placeholder", () => {
    const p = parseApplications(text);
    expect(p.rows).toEqual([]);
    expect(p.malformed).toEqual([]);
    expect(p.readOnly).toBe(false);
  });

  it("the unmigrated v1 file is read-only with a migrate hint", () => {
    const p = parseApplications(read("legacy-2026-10-06"));
    expect(p.readOnly).toMatchObject({
      reason: expect.stringContaining("scripts/apps.sh migrate"),
    });
  });
});

describe("rows", () => {
  it("parses one row", () => {
    const p = parseApplications(read("one-row"));
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({
      date: "2026-10-05",
      company: "Acme",
      role: "Software Engineer",
      lane: "tech",
      resume: "tailored/acme-swe",
      fit: "82",
      match: "71",
      source: "LinkedIn",
      status: "applied",
      next: "Follow up with Jane 2026-10-12",
      link: "https://acme.test/jobs/1",
      lineIndex: 0,
    });
    expect(p.rows[0].key).toMatch(/^[0-9a-f]{40}$/);
  });

  it("unescapes pipes on read and re-escapes on write", () => {
    const text = read("escaped");
    const p = parseApplications(text);
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0].company).toBe("Foo | Bar");
    expect(p.rows[0].role).toBe("Engineer | Platform");
    expect(p.rows[0].link).toBe("https://x.test/?a=1|2");
    // The empty-score row is still a valid 11-cell row.
    expect(p.rows[2].fit).toBe("");
    expect(p.rows[2].match).toBe("");

    const t = splitTable(text, APPLICATIONS_HEADER_V2);
    const cells = parseRow(t.body[0])!;
    expect(serializeRow(cells)).toBe(t.body[0]);
  });

  it("parses CRLF files and keeps CRLF on write", () => {
    const text = read("crlf");
    const t = splitTable(text, APPLICATIONS_HEADER_V2);
    expect(t.eol).toBe("\r\n");
    expect(parseApplications(text).rows).toHaveLength(1);
    t.body = [serializeRow(["a", "b"]), ...t.body];
    const out = joinTable(t);
    expect(out.replace(/\r\n/g, "")).not.toContain("\n");
    expect(out).toContain("| a | b |\r\n");
  });

  it("keeps a missing trailing newline missing", () => {
    const text = read("no-eol");
    const t = splitTable(text, APPLICATIONS_HEADER_V2);
    expect(t.endsWithNewline).toBe(false);
    expect(joinTable(t).endsWith("\n")).toBe(false);
    t.body = [...t.body, "| x |"];
    expect(joinTable(t).endsWith("| x |")).toBe(true);
  });

  it("goes read-only when the header changed", () => {
    const p = parseApplications(read("header-changed"));
    expect(p.readOnly).toMatchObject({
      reason: expect.stringContaining("header"),
    });
    expect(p.rows).toEqual([]);
    expect(splitTable(read("header-changed"), APPLICATIONS_HEADER).found).toBe(
      false,
    );
  });

  it("reports a 10-cell row as malformed and leaves it verbatim", () => {
    const text = read("malformed");
    const p = parseApplications(text);
    expect(p.rows.map((r) => r.company)).toEqual(["Acme", "Okay Co"]);
    expect(p.malformed).toEqual([
      { lineIndex: 1, text: expect.stringContaining("Bad Co") },
    ]);
    const t = splitTable(text, APPLICATIONS_HEADER_V2);
    expect(t.body[1]).toBe(p.malformed[0].text);
    // Row identity still points at the right body line after the malformed one.
    expect(p.rows[1].lineIndex).toBe(2);
  });

  it("never touches text after the table (e.g. an old outreach log) when the table is edited", () => {
    const text = read("one-row");
    const t = splitTable(text, APPLICATIONS_HEADER_V2);
    t.body = ["| new |", ...t.body];
    const out = joinTable(t);
    const idx = out.indexOf("## Outreach log");
    expect(out.slice(idx)).toBe(text.slice(text.indexOf("## Outreach log")));
  });
});

describe("parseRow / serializeRow", () => {
  it("trims cells and drops the outer empty pieces", () => {
    expect(parseRow("|  a | b  |")).toEqual(["a", "b"]);
    expect(parseRow("| a |  |  |")).toEqual(["a", "", ""]);
    expect(parseRow("not a row")).toBeNull();
  });

  it("escapes pipes and collapses newlines and tabs", () => {
    expect(serializeRow(["A|B", "x\ny\tz", " pad "])).toBe(
      "| A\\|B | x y z | pad |",
    );
  });

  it("detects the placeholder", () => {
    expect(isPlaceholderRow(["", "", ""])).toBe(true);
    expect(isPlaceholderRow(["", "x"])).toBe(false);
  });
});
