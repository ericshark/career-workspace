import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  careerProfile,
  cleanPath,
  hasEnv,
  setEnv,
  writePrivate,
} from "./lib.mjs";

test("paths typed or dragged into a terminal", () => {
  assert.equal(cleanPath("'/a b/c.md' "), "/a b/c.md");
  assert.equal(cleanPath("/a\\ b/c.md"), "/a b/c.md");
  assert.equal(cleanPath("~/x.md"), path.join(os.homedir(), "x.md"));
  assert.equal(cleanPath("  "), "");
});
test("keys replace only their own line and reject odd text", () => {
  const text = "# note\nOPENAI_API_KEY=\nANTHROPIC_API_KEY=keep\n";
  const next = setEnv(text, "OPENAI_API_KEY", "sk-test_1");
  assert.equal(
    next,
    "# note\nOPENAI_API_KEY=sk-test_1\nANTHROPIC_API_KEY=keep\n",
  );
  assert.equal(hasEnv(text, "OPENAI_API_KEY"), false);
  assert.equal(hasEnv(next, "OPENAI_API_KEY"), true);
  assert.equal(setEnv("A=1", "B", "2"), "A=1\nB=2\n");
  for (const bad of ["a b", "a\nB=1", "a$b", 'a"b'])
    assert.throws(() => setEnv("", "K", bad));
});
test("private files are readable only by the owner", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cw-"));
  const file = path.join(dir, ".env.local");
  writePrivate(file, "A=1\n");
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  fs.symlinkSync(file, path.join(dir, "link"));
  assert.throws(() => writePrivate(path.join(dir, "link"), "B=1\n"));
  fs.rmSync(dir, { recursive: true });
});
test("imported documents become a profile", () => {
  assert.equal(careerProfile("# Mine\r\nText", "a.md"), "# Mine\nText\n");
  assert.match(
    careerProfile("Built things", "cv-->.pdf"),
    /^# Career profile[\s\S]*Built things\n$/,
  );
  assert.equal(careerProfile("x", "a-->b").match(/-->/g).length, 1);
});
