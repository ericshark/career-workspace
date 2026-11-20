// Test-only copies: validation and archives never touch real masters or tracker records.
import fs from "node:fs";
import path from "node:path";
export function seedResumes(root: string) {
  const repo = path.resolve(import.meta.dirname, "../..");
  for (const rel of [
    "prompts/review-job.md",
    "prompts/tailor-resume.md",
    "prompts/quick-add.md",
  ]) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(repo, rel), dest);
  }
  for (const category of ["tech", "general", "datacenter"]) {
    for (const [from, to] of [
      [`source/${category}/resume.tex`, `source/${category}/resume.tex`],
      [`resumes/${category}/Resume.pdf`, `resumes/${category}/Resume.pdf`],
      ["scripts/ats_check.py", "scripts/ats_check.py"],
    ]) {
      const dest = path.join(root, to);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(path.join(repo, from), dest);
    }
  }
}

/** Restore directory permissions only within a test root before removing immutable fixture archives. */
export function removeTestRoot(root: string) {
  const visit = (dir: string) => {
    fs.chmodSync(dir, 0o755);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
      if (entry.isDirectory() && !entry.isSymbolicLink())
        visit(path.join(dir, entry.name));
  };
  if (root && fs.existsSync(root)) {
    visit(root);
    fs.rmSync(root, { recursive: true, force: true });
  }
}
