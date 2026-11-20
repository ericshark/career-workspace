import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { ApiError } from "./api";
import { resolveExpected } from "./paths";

export const TEXT_LIMIT = 1024 * 1024;
export const PDF_LIMIT = 20 * 1024 * 1024;
export const titleSchema = z.string().trim().min(1).max(150);
export const docSchema = z.object({
  id: z.uuid(),
  title: titleSchema,
  kind: z.enum(["note", "text", "pdf"]),
  content: z.string().max(TEXT_LIMIT),
  updatedAt: z.string(),
});
export type LibraryDoc = z.infer<typeof docSchema>;
const root = () => resolveExpected(".documents");
function folder(id: string) {
  if (!z.uuid().safeParse(id).success)
    throw new ApiError("VALIDATION", "Invalid document ID", 400);
  return resolveExpected(`.documents/${id}`);
}
function itemPath(id: string, name: "doc.json" | "document.pdf") {
  folder(id);
  return resolveExpected(`.documents/${id}/${name}`);
}
export async function getDoc(id: string) {
  try {
    return docSchema.parse(
      JSON.parse(await fs.readFile(itemPath(id, "doc.json"), "utf8")),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new ApiError("NOT_FOUND", "Document not found", 404);
    throw error;
  }
}
export async function listLibrary() {
  const items = await fs
    .readdir(root(), { withFileTypes: true })
    .catch((error) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });
  const docs = await Promise.all(
    items
      .filter((i) => i.isDirectory() && z.uuid().safeParse(i.name).success)
      .map((i) => getDoc(i.name)),
  );
  return docs
    .map(({ id, title, kind, updatedAt }) => ({ id, title, kind, updatedAt }))
    .sort((a, b) => a.title.localeCompare(b.title));
}
export async function createDoc(
  input: Pick<LibraryDoc, "title" | "kind" | "content">,
  pdf?: Uint8Array,
) {
  const doc = docSchema.parse({
    ...input,
    id: randomUUID(),
    updatedAt: new Date().toISOString(),
  });
  await fs.mkdir(root(), { recursive: true, mode: 0o700 });
  const tmp = await fs.mkdtemp(path.join(root(), ".import-"));
  try {
    await fs.writeFile(path.join(tmp, "doc.json"), JSON.stringify(doc), {
      mode: 0o600,
    });
    if (pdf)
      await fs.writeFile(path.join(tmp, "document.pdf"), pdf, { mode: 0o600 });
    await fs.rename(tmp, folder(doc.id));
    return doc;
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}
export async function updateDoc(id: string, title: string, content?: string) {
  const old = await getDoc(id);
  const doc = docSchema.parse({
    ...old,
    title,
    content: old.kind === "pdf" ? "" : (content ?? old.content),
    updatedAt: new Date().toISOString(),
  });
  const temp = path.join(folder(id), randomUUID() + ".tmp");
  try {
    await fs.writeFile(temp, JSON.stringify(doc), { flag: "wx", mode: 0o600 });
    await fs.rename(temp, itemPath(id, "doc.json"));
    return doc;
  } finally {
    await fs.rm(temp, { force: true });
  }
}
export async function deleteDoc(id: string) {
  await getDoc(id);
  await fs.rm(folder(id), { recursive: true });
}
export async function getPdf(id: string) {
  if ((await getDoc(id)).kind !== "pdf")
    throw new ApiError("NOT_FOUND", "PDF not found", 404);
  return fs.readFile(itemPath(id, "document.pdf"));
}
