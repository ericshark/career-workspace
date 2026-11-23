// The slice of node:fs the app's storage code uses, backed by memory. A reload starts over.
type Node = { data: string; mtimeMs: number; ino: number };
type Err = Error & { code: string };
const files = new Map<string, Node>();
const dirs = new Map<string, number>([["/", 1]]);
const open = new Map<number, string>();
let clock = 1;
let inode = 1;
let fd = 10;
const tick = () => ++clock;
const norm = (p: string) => (p.length > 1 ? p.replace(/\/+$/, "") : p);
const parent = (p: string) => p.slice(0, p.lastIndexOf("/")) || "/";
function error(code: string, p: string): Err {
  return Object.assign(new Error(`${code}: ${p}`), { code });
}
function ensureParent(p: string) {
  if (!dirs.has(parent(p))) throw error("ENOENT", p);
  dirs.set(parent(p), tick());
}
export function mkdirSync(raw: string, opts?: { recursive?: boolean }) {
  const p = norm(raw);
  if (dirs.has(p)) {
    if (opts?.recursive) return;
    throw error("EEXIST", p);
  }
  if (opts?.recursive && p !== "/") mkdirSync(parent(p), opts);
  ensureParent(p);
  dirs.set(p, tick());
}
export function existsSync(raw: string) {
  const p = norm(raw);
  return files.has(p) || dirs.has(p);
}
export function readFileSync(raw: string, _enc?: unknown): string {
  const f = files.get(norm(raw));
  if (!f) throw error("ENOENT", raw);
  return f.data;
}
export function writeFileSync(
  target: string | number,
  data: string,
  opts?: unknown,
) {
  const p = typeof target === "number" ? open.get(target)! : norm(target);
  const flag = (opts as { flag?: string } | undefined)?.flag;
  if (flag === "wx" && files.has(p)) throw error("EEXIST", p);
  ensureParent(p);
  files.set(p, { data: String(data), mtimeMs: tick(), ino: ++inode });
}
export function openSync(raw: string, flag: string) {
  const p = norm(raw);
  if (flag === "wx" && files.has(p)) throw error("EEXIST", p);
  if (flag === "r" && !existsSync(p)) throw error("ENOENT", p);
  if (flag !== "r") writeFileSync(p, "");
  open.set(++fd, p);
  return fd;
}
export function writeSync(handle: number, data: string) {
  const p = open.get(handle)!;
  writeFileSync(p, (files.get(p)?.data ?? "") + data);
}
export function closeSync(handle: number) {
  open.delete(handle);
}
export function fsyncSync(_handle: number) {}
export function statSync(raw: string) {
  const p = norm(raw);
  const f = files.get(p);
  const dir = dirs.get(p);
  if (!f && dir === undefined) throw error("ENOENT", p);
  return {
    mtimeMs: f?.mtimeMs ?? dir!,
    ino: f?.ino ?? 1,
    size: f?.data.length ?? 0,
    isFile: () => !!f,
    isDirectory: () => !f,
    isSymbolicLink: () => false,
  };
}
export const lstatSync = statSync;
export function realpathSync(raw: string) {
  if (!existsSync(raw)) throw error("ENOENT", raw);
  return norm(raw);
}
export function readdirSync(raw: string, opts?: { withFileTypes?: boolean }) {
  const p = norm(raw);
  if (!dirs.has(p)) throw error("ENOENT", p);
  const prefix = p === "/" ? "/" : `${p}/`;
  const names = [...new Set([...files.keys(), ...dirs.keys()])]
    .filter((n) => n.startsWith(prefix) && n !== "/")
    .map((n) => n.slice(prefix.length))
    .filter((n) => n && !n.includes("/"));
  if (!opts?.withFileTypes) return names;
  return names.map((name) => ({
    name,
    isDirectory: () => dirs.has(prefix + name),
    isFile: () => files.has(prefix + name),
  }));
}
export function renameSync(from: string, to: string) {
  const a = norm(from);
  const b = norm(to);
  if (!existsSync(a)) throw error("ENOENT", a);
  ensureParent(b);
  for (const [name, node] of [...files])
    if (name === a || name.startsWith(`${a}/`)) {
      files.delete(name);
      files.set(b + name.slice(a.length), {
        ...node,
        mtimeMs: tick(),
        ino: ++inode,
      });
    }
  for (const name of [...dirs.keys()])
    if (name === a || name.startsWith(`${a}/`)) {
      dirs.delete(name);
      dirs.set(b + name.slice(a.length), tick());
    }
  ensureParent(a);
}
export function rmSync(
  raw: string,
  opts?: { recursive?: boolean; force?: boolean },
) {
  const p = norm(raw);
  if (!existsSync(p)) {
    if (opts?.force) return;
    throw error("ENOENT", p);
  }
  for (const name of [...files.keys()])
    if (name === p || name.startsWith(`${p}/`)) files.delete(name);
  for (const name of [...dirs.keys()])
    if (name === p || name.startsWith(`${p}/`)) dirs.delete(name);
  ensureParent(p);
}
export const unlinkSync = rmSync;
const fs = {
  mkdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  openSync,
  writeSync,
  closeSync,
  fsyncSync,
  statSync,
  lstatSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
};
export default fs;
