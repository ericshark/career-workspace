import fs from "./fs";

let temp = 0;
const promises = {
  mkdir: async (p: string, o?: { recursive?: boolean }) => fs.mkdirSync(p, o),
  readFile: async (p: string, e?: unknown) => fs.readFileSync(p, e),
  writeFile: async (p: string, d: string, o?: unknown) =>
    fs.writeFileSync(p, d, o),
  readdir: async (p: string, o?: { withFileTypes?: boolean }) =>
    fs.readdirSync(p, o),
  rename: async (a: string, b: string) => fs.renameSync(a, b),
  rm: async (p: string, o?: { recursive?: boolean; force?: boolean }) =>
    fs.rmSync(p, o),
  mkdtemp: async (prefix: string) => {
    const dir = `${prefix}${++temp}`;
    fs.mkdirSync(dir);
    return dir;
  },
};
export default promises;
