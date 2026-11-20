import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../..");
const canonical = path.join(root, ".claude/skills");
describe("shared career skills", () => {
  it("has an executable Claude SDK launcher", () => {
    const ui = path.join(root, "ui");
    for (const file of [
      path.join(
        ui,
        `node_modules/@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`,
      ),
    ])
      expect(
        () => fs.accessSync(file, fs.constants.R_OK | fs.constants.X_OK),
        file,
      ).not.toThrow();
  });
  it("exposes every canonical skill to Codex through a working link", () => {
    const names = fs
      .readdirSync(canonical)
      .filter((name) => fs.existsSync(path.join(canonical, name, "SKILL.md")));
    expect(names.length).toBeGreaterThan(0);
    expect(fs.readdirSync(path.join(root, ".agents/skills")).sort()).toEqual(
      names.sort(),
    );
    for (const name of names) {
      const link = path.join(root, ".agents/skills", name);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(link)).toBe(
        fs.realpathSync(path.join(canonical, name)),
      );
      expect(fs.readFileSync(path.join(link, "SKILL.md"), "utf8")).toBe(
        fs.readFileSync(path.join(canonical, name, "SKILL.md"), "utf8"),
      );
    }
  });
  it("resolves workspace file dependencies named by the skills", () => {
    for (const name of fs.readdirSync(canonical)) {
      const file = path.join(canonical, name, "SKILL.md");
      if (!fs.existsSync(file)) continue;
      const text = fs.readFileSync(file, "utf8");
      // Literal file references only; command arguments and template paths are not dependencies.
      for (const match of text.matchAll(
        /`((?:scripts|ui\/docs|guide|profile|records)\/[\w./-]+\.(?:md|sh|py))`/g,
      )) {
        expect(
          fs.existsSync(path.join(root, match[1])),
          `${name}: ${match[1]}`,
        ).toBe(true);
      }
    }
  });
});
