import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
const repo = path.resolve(import.meta.dirname, "../..");
let fixture: string;
afterEach(() => fs.rmSync(fixture, { recursive: true, force: true }));
function status(command: string) {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "career-launcher-"));
  fs.mkdirSync(path.join(fixture, "scripts"));
  fs.mkdirSync(path.join(fixture, "ui/.cache"), { recursive: true });
  fs.mkdirSync(path.join(fixture, "bin"));
  fs.copyFileSync(
    path.join(repo, "scripts/ui.sh"),
    path.join(fixture, "scripts/ui.sh"),
  );
  fs.writeFileSync(path.join(fixture, "ui/.cache/launcher.pid"), "700 4321");
  fs.writeFileSync(
    path.join(fixture, "bin/ps"),
    '#!/bin/bash\nprintf "%s\\n" "$FIXTURE_COMMAND"\n',
    { mode: 0o755 },
  );
  return execFileSync("bash", [path.join(fixture, "scripts/ui.sh"), "status"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture}/bin:${process.env.PATH}`,
      FIXTURE_COMMAND: command.replace("FIXTURE", fixture),
    },
  });
}
it("reports the port owned by the checkout launcher", () => {
  expect(status("node FIXTURE/ui/scripts/serve.mjs start")).toContain(
    "http://127.0.0.1:4321",
  );
});
it("ignores a stale pid now owned by an unrelated process", () => {
  expect(status("node another-app.js")).toContain("not running");
});
it("reuses a current build and rebuilds when UI inputs change", () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), "career-build-"));
  const launcher = path.join(fixture, "serve.mjs");
  fs.copyFileSync(path.join(repo, "ui/scripts/serve.mjs"), launcher);
  const next = path.join(fixture, "node_modules/next/dist/bin");
  fs.mkdirSync(next, { recursive: true });
  fs.writeFileSync(
    path.join(next, "next.js"),
    `const fs = require("node:fs");
    if (process.argv[2] === "build") {
      fs.mkdirSync(".next", { recursive: true });
      fs.writeFileSync(".next/BUILD_ID", require("node:crypto").randomUUID());
    }
    console.log(process.argv[2]);`,
  );
  fs.mkdirSync(path.join(fixture, "src"));
  const source = path.join(fixture, "src/page.tsx");
  fs.writeFileSync(source, "first version");
  const start = () =>
    execFileSync(process.execPath, [launcher], {
      cwd: fixture,
      env: { ...process.env, CAREER_PORT: "43989" },
      encoding: "utf8",
    });
  expect(start()).toMatch(/^build$/m);
  expect(start()).not.toMatch(/^build$/m);
  fs.writeFileSync(path.join(fixture, "applications.md"), "runtime records");
  expect(start()).not.toMatch(/^build$/m);
  fs.writeFileSync(source, "other version");
  expect(start()).toMatch(/^build$/m);
  fs.unlinkSync(source);
  expect(start()).toMatch(/^build$/m);
});
