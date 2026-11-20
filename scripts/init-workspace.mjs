import { constants } from "node:fs";
import { copyFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const templates = path.join(root, "templates/workspace");
async function initialize(from, to) {
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) await initialize(source, target);
    else {
      try {
        await copyFile(source, target, constants.COPYFILE_EXCL);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
  }
}
await initialize(templates, root);
console.log("Workspace ready. Run ./scripts/ui.sh to open Career Workspace.");
