import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// CAREER_ROOT is read once at import of lib/paths, so set it before importing the guard.
let root: string;
let outside: string;
let scratch: string;
let guardToolCall: typeof import("@/lib/claude/tailor").guardToolCall;
let findForbiddenTex: typeof import("@/lib/claude/tailor").findForbiddenTex;
let hashMasters: typeof import("@/lib/claude/tailor").hashMasters;

const SLUG = "acme-swe";

beforeAll(async () => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "guard-root-")));
  outside = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "guard-out-")),
  );
  scratch = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "guard-scratch-")),
  );
  fs.mkdirSync(path.join(root, "profile"));
  fs.writeFileSync(path.join(root, "profile", "career.md"), "x");
  fs.mkdirSync(path.join(root, "source", "tech"), { recursive: true });
  fs.writeFileSync(path.join(root, "source", "tech", "resume.tex"), "tex");
  fs.mkdirSync(path.join(root, "source", "tailored", SLUG), {
    recursive: true,
  });
  // Symlinks inside the tailored dir / root that point at forbidden places.
  fs.symlinkSync(
    path.join(root, "source", "tech"),
    path.join(root, "source", "tailored", SLUG, "link"),
  );
  fs.symlinkSync(outside, path.join(root, "source", "tailored", SLUG, "out"));
  fs.symlinkSync(outside, path.join(root, "escape"));
  process.env.CAREER_ROOT = root;
  ({ guardToolCall, hashMasters, findForbiddenTex } =
    await import("@/lib/claude/tailor"));
});

afterAll(() => {
  for (const d of [root, outside, scratch])
    fs.rmSync(d, { recursive: true, force: true });
});

// Test tables are built before beforeAll creates the temp dirs, so commands use <SCRATCH>/<ROOT>
// placeholders that are resolved here, at call time.
const g = (tool: string, input: Record<string, unknown>, slug = SLUG) => {
  const resolved =
    typeof input.command === "string"
      ? {
          ...input,
          command: input.command
            .replaceAll("<SCRATCH>", scratch)
            .replaceAll("<ROOT>", root),
        }
      : input;
  return guardToolCall(slug, tool, resolved, scratch).allow;
};

describe("guardToolCall: docs/09 table", () => {
  it.each([
    ["Write", { file_path: "source/tailored/acme-swe/resume.tex" }, true],
    ["Write", { file_path: "source/tech/resume.tex" }, false],
    ["Edit", { file_path: "profile/career.md" }, false],
    // `..` climbs out of the slug dir into a master
    [
      "Write",
      { file_path: "source/tailored/acme-swe/../../tech/resume.tex" },
      false,
    ],
    // symlink inside tailored/acme-swe pointing at source/tech
    ["Write", { file_path: "source/tailored/acme-swe/link/resume.tex" }, false],
    [
      "Bash",
      {
        command:
          "scripts/build.sh source/tailored/acme-swe/resume.tex --png <SCRATCH>",
      },
      true,
    ],
    ["Bash", { command: "scripts/build.sh source/tech/resume.tex" }, false],
    [
      "Bash",
      {
        command:
          "scripts/build.sh source/tailored/acme-swe/resume.tex; rm -rf ~",
      },
      false,
    ],
    ["Bash", { command: "cat ~/.ssh/id_rsa" }, false],
    ["Read", { file_path: "/etc/passwd" }, false],
    ["Read", { file_path: "profile/career.md" }, true],
  ])("%s %j -> allow=%s", (tool, input, allow) => {
    expect(g(tool, input as Record<string, unknown>)).toBe(allow);
  });
});

describe("guardToolCall: Read / Glob / Grep", () => {
  it("allows absolute paths inside the root", () => {
    expect(g("Read", { file_path: path.join(root, "profile/career.md") })).toBe(
      true,
    );
  });
  it("denies .. escapes and symlink escapes", () => {
    expect(g("Read", { file_path: "../etc/passwd" })).toBe(false);
    expect(g("Read", { file_path: "escape/secret" })).toBe(false);
    expect(g("Read", { file_path: path.join(outside, "x") })).toBe(false);
  });
  it("denies missing / non-string paths", () => {
    expect(g("Read", {})).toBe(false);
    expect(g("Read", { file_path: 5 })).toBe(false);
  });
  it("Glob/Grep must name a content directory, and check path + pattern", () => {
    expect(g("Glob", { pattern: "**/*.md" })).toBe(false); // unscoped: would sweep ui/.env.local
    expect(g("Glob", { pattern: "**/*.md", path: "profile" })).toBe(true);
    expect(g("Grep", { pattern: "x", path: "ui" })).toBe(false);
    expect(g("Grep", { pattern: "x", path: "." })).toBe(false);
    expect(g("Grep", { pattern: "foo", path: "profile" })).toBe(true);
    expect(g("Grep", { pattern: "foo", path: "/etc" })).toBe(false);
    expect(g("Glob", { pattern: "/etc/*" })).toBe(false);
    expect(g("Glob", { pattern: "../../*" })).toBe(false);
    expect(g("Grep", { pattern: "x", glob: "../*" })).toBe(false);
  });
});

describe("guardToolCall: protected files", () => {
  it.each([
    "ui/.env.local",
    "ui/.env",
    ".git/config",
    "ui/.cache/runs/abc.json",
    "ui/node_modules/x/package.json",
  ])("denies Read of %s", (rel) => {
    expect(g("Read", { file_path: rel })).toBe(false);
    expect(g("Read", { file_path: path.join(root, rel) })).toBe(false);
  });
  it("still allows normal content files", () => {
    expect(g("Read", { file_path: "profile/career.md" })).toBe(true);
    expect(g("Read", { file_path: "source/tech/resume.tex" })).toBe(true);
  });
});

describe("findForbiddenTex", () => {
  it.each([
    "\\input{/etc/passwd}",
    "\\include{x}",
    "\\openin1=x",
    "\\immediate\\write18{ls}",
    "\\catcode`\\@=11",
  ])("flags %s", (t) => expect(findForbiddenTex(t)).not.toBeNull());
  it("allows the template's \\input{glyphtounicode} but not other \\input targets", () => {
    expect(
      findForbiddenTex("\\input{glyphtounicode}\n\\pdfgentounicode=1"),
    ).toBeNull();
    expect(
      findForbiddenTex("\\input{glyphtounicode}\\input{/etc/passwd}"),
    ).toBe("\\input");
    expect(findForbiddenTex("\\input{glyphtounicode2}")).toBe("\\input");
  });
  it("allows normal resume LaTeX and ignores commented-out commands", () => {
    expect(
      findForbiddenTex(
        "\\resumeItem{Built things} % \\input{x}\n\\textbf{Skills}",
      ),
    ).toBeNull();
    expect(findForbiddenTex("\\inputenc is not \\input")).toBe("\\input");
    expect(findForbiddenTex("\\usepackage[utf8]{inputenc}")).toBeNull();
  });
});

describe("guardToolCall: Write / Edit", () => {
  it("allows an absolute path in the slug dir and nested new files", () => {
    expect(
      g("Write", {
        file_path: path.join(root, "source/tailored", SLUG, "resume.tex"),
      }),
    ).toBe(true);
    expect(
      g("Edit", { file_path: "source/tailored/acme-swe/sub/new.tex" }),
    ).toBe(true);
  });
  it("denies another slug's dir and the tailored dir itself", () => {
    expect(g("Write", { file_path: "source/tailored/other/resume.tex" })).toBe(
      false,
    );
    expect(g("Write", { file_path: "source/tailored/acme-swe" })).toBe(false);
  });
  it("denies a symlink in the slug dir that leaves the root", () => {
    expect(
      g("Write", { file_path: "source/tailored/acme-swe/out/evil.tex" }),
    ).toBe(false);
  });
  it("allows the scratch dir, denies escapes from it", () => {
    expect(g("Write", { file_path: path.join(scratch, "a.png") })).toBe(true);
    expect(g("Write", { file_path: path.join(scratch, "..", "a.png") })).toBe(
      false,
    );
    expect(g("Write", { file_path: path.join(outside, "a.png") })).toBe(false);
  });
  it("denies a missing file_path", () => {
    expect(g("Write", {})).toBe(false);
  });
});

describe("guardToolCall: Bash", () => {
  const base = "scripts/build.sh source/tailored/acme-swe/resume.tex";
  it.each([
    [base, true],
    [`${base} --no-text`, true],
    [`${base} --png <SCRATCH> --no-text`, true],
    [`${base} --png /tmp/x --no-text`, false],
    [`${base} --png rel/dir`, false],
    [`${base} --png <ROOT>/ui/.cache/png`, true],
    [`${base} && ls`, false],
    [`${base} || ls`, false],
    [`${base} | cat`, false],
    [`${base} \`id\``, false],
    [`${base} $(id)`, false],
    [`${base} --png /tmp/x > /etc/x`, false],
    [`${base} < /etc/passwd`, false],
    [`${base}\nrm -rf /`, false],
    [`${base} --png /tmp/../x`, false],
    [`${base} --png $HOME`, false],
    [`${base} extra`, false],
    [`./${base}`, false],
    [`bash ${base}`, false],
    ["scripts/build.sh source/tailored/other/resume.tex", false],
    ["scripts/build.sh source/tailored/acme-swe/../../tech/resume.tex", false],
  ])("%j -> %s", (command, allow) => {
    expect(g("Bash", { command })).toBe(allow);
  });
  it("denies non-string commands", () => {
    expect(g("Bash", {})).toBe(false);
  });
});

describe("guardToolCall: misc", () => {
  it("denies unknown tools", () => {
    expect(g("WebFetch", { url: "http://x" })).toBe(false);
  });
  it("denies a malformed slug (fail closed)", () => {
    expect(g("Write", { file_path: "source/tailored/../x" }, "..")).toBe(false);
    expect(g("Bash", { command: "scripts/build.sh x" }, "a.*")).toBe(false);
  });
  it("fails closed when the scratch dir does not exist", () => {
    const d = guardToolCall(
      SLUG,
      "Write",
      { file_path: "/nope/x" },
      "/does/not/exist",
    );
    expect(d.allow).toBe(false);
    expect(d.reason).toBeTruthy();
  });
});

describe("hashMasters", () => {
  it("hashes existing masters by relative path and skips missing ones", async () => {
    fs.mkdirSync(path.join(root, "resumes", "tech"), { recursive: true });
    fs.writeFileSync(path.join(root, "resumes/tech/Resume.pdf"), "pdf");
    const h = await hashMasters();
    expect(Object.keys(h).sort()).toEqual([
      "resumes/tech/Resume.pdf",
      "source/tech/resume.tex",
    ]);
    expect(h["source/tech/resume.tex"]).toMatch(/^[0-9a-f]{64}$/);
    // Changing a master changes its hash.
    fs.writeFileSync(path.join(root, "source/tech/resume.tex"), "changed");
    const h2 = await hashMasters();
    expect(h2["source/tech/resume.tex"]).not.toBe(h["source/tech/resume.tex"]);
  });
});

describe("v2 guard additions", () => {
  it("allows the SDK's StructuredOutput tool (the tailor report)", () => {
    expect(g("StructuredOutput", { changes: [] })).toBe(true);
  });

  it("lets the agent read only its own scratch PNG", () => {
    const own = path.join(root, "ui", ".cache", "tailor-scratch", SLUG);
    const other = path.join(root, "ui", ".cache", "tailor-scratch", "other-co");
    fs.mkdirSync(own, { recursive: true });
    fs.mkdirSync(other, { recursive: true });
    fs.writeFileSync(path.join(own, "resume.png"), "png");
    fs.writeFileSync(path.join(other, "resume.png"), "png");
    fs.writeFileSync(path.join(own, "notes.txt"), "txt");
    fs.mkdirSync(path.join(root, "ui", ".cache", "runs"), { recursive: true });
    fs.writeFileSync(path.join(root, "ui", ".cache", "runs", "x.json"), "{}");

    expect(g("Read", { file_path: path.join(own, "resume.png") })).toBe(true);
    expect(
      g("Read", { file_path: `ui/.cache/tailor-scratch/${SLUG}/resume.png` }),
    ).toBe(true);
    expect(g("Read", { file_path: path.join(other, "resume.png") })).toBe(
      false,
    );
    expect(g("Read", { file_path: path.join(own, "notes.txt") })).toBe(false);
    expect(
      g("Read", {
        file_path: path.join(root, "ui", ".cache", "runs", "x.json"),
      }),
    ).toBe(false);
    expect(
      g("Read", {
        file_path: `ui/.cache/tailor-scratch/${SLUG}/../other-co/resume.png`,
      }),
    ).toBe(false);
  });
});

describe("canonical policy regressions", () => {
  it("denies protected-file aliases and traversal despite an allowed spelling", () => {
    const secret = path.join(root, "ui/.env.local");
    fs.mkdirSync(path.dirname(secret), { recursive: true });
    fs.writeFileSync(secret, "fixture-token");
    const alias = path.join(root, "profile/secret-alias.txt");
    fs.symlinkSync(secret, alias);
    try {
      expect(g("Read", { file_path: alias })).toBe(false);
      expect(g("Read", { file_path: "source/../ui/.env.local" })).toBe(false);
      expect(g("Grep", { path: "profile", pattern: "token" })).toBe(false);
      expect(g("Glob", { path: alias, pattern: "*" })).toBe(false);
    } finally {
      fs.unlinkSync(alias);
    }
  });
  it("denies an entire redirected tailored root and a redirected PNG root", () => {
    const redirected = path.join(root, "source/tailored/redirected");
    fs.symlinkSync(path.join(root, "source/tech"), redirected);
    expect(
      g(
        "Write",
        { file_path: "source/tailored/redirected/resume.tex" },
        "redirected",
      ),
    ).toBe(false);
    expect(
      g(
        "Bash",
        { command: "scripts/build.sh source/tailored/redirected/resume.tex" },
        "redirected",
      ),
    ).toBe(false);
    const png = path.join(root, "ui/.cache/png");
    fs.mkdirSync(path.dirname(png), { recursive: true });
    fs.symlinkSync(path.join(root, "source/tech"), png);
    try {
      expect(
        g("Bash", {
          command: `scripts/build.sh source/tailored/${SLUG}/resume.tex --png ${png}`,
        }),
      ).toBe(false);
    } finally {
      fs.unlinkSync(png);
    }
  });
});
