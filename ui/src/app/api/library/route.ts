import { z } from "zod";
import { ApiError, errorResponse, parseBody } from "@/lib/api";
import {
  createDoc,
  deleteDoc,
  getDoc,
  listLibrary,
  PDF_LIMIT,
  TEXT_LIMIT,
  titleSchema,
  updateDoc,
} from "@/lib/library";

export const dynamic = "force-dynamic";
const content = z.string().max(TEXT_LIMIT);

export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("id");
    return Response.json(id ? await getDoc(id) : await listLibrary());
  } catch (error) {
    return errorResponse(error);
  }
}
export async function POST(req: Request) {
  try {
    if (req.headers.get("content-type")?.startsWith("multipart/form-data")) {
      if (
        new URL(req.headers.get("origin") ?? "http://invalid").host !==
        req.headers.get("host")
      )
        throw new ApiError("VALIDATION", "Import requires the local app", 403);
      const length = Number(req.headers.get("content-length"));
      if (!length || length > PDF_LIMIT + 16384)
        throw new ApiError(
          "VALIDATION",
          "File is too large (20 MB maximum)",
          413,
        );
      const file = (await req.formData()).get("file");
      if (!(file instanceof File))
        throw new ApiError("VALIDATION", "Choose a file", 400);
      const match = /\.(md|txt|pdf)$/i.exec(file.name);
      if (!match)
        throw new ApiError(
          "VALIDATION",
          "Choose a .md, .txt, or .pdf file",
          400,
        );
      const ext = match[1].toLowerCase();
      const title =
        file.name.slice(0, -match[0].length).trim().slice(0, 150) ||
        "Imported document";
      if (!file.size || file.size > (ext === "pdf" ? PDF_LIMIT : TEXT_LIMIT))
        throw new ApiError(
          "VALIDATION",
          "File is empty or exceeds the size limit",
          400,
        );
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (ext === "pdf") {
        if (new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-")
          throw new ApiError("VALIDATION", "Invalid PDF", 400);
        return Response.json(
          await createDoc({ title, kind: "pdf", content: "" }, bytes),
          { status: 201 },
        );
      }
      let decoded: string;
      try {
        decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new ApiError(
          "VALIDATION",
          "Save the file as UTF-8 text and try again",
          400,
        );
      }
      return Response.json(
        await createDoc({
          title,
          kind: ext === "md" ? "note" : "text",
          content: decoded,
        }),
        { status: 201 },
      );
    }
    const body = await parseBody(
      req,
      z.object({ title: titleSchema, content }),
    );
    return Response.json(await createDoc({ ...body, kind: "note" }), {
      status: 201,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
export async function PATCH(req: Request) {
  try {
    const {
      id,
      title,
      content: body,
    } = await parseBody(
      req,
      z.object({
        id: z.uuid(),
        title: titleSchema,
        content: content.optional(),
      }),
    );
    return Response.json(await updateDoc(id, title, body));
  } catch (error) {
    return errorResponse(error);
  }
}
export async function DELETE(req: Request) {
  try {
    const { id } = await parseBody(req, z.object({ id: z.uuid() }));
    await deleteDoc(id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
}
