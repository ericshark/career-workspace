import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/api";
import { previewSchema, summarize, type Snapshot } from "@/lib/workshop/model";
import { readWorkshop } from "@/lib/workshop/store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const input = await parseBody(request, previewSchema);
    const { snapshot, hash } = readWorkshop();
    return NextResponse.json({
      hash,
      current: summarize(snapshot),
      replacement: summarize(input.snapshot),
      snapshot: input.snapshot,
      changes: describeChanges(snapshot, input.snapshot),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

function describeChanges(current: Snapshot, replacement: Snapshot) {
  const original = new Map(
    current.items.map((item) => [item.id, JSON.stringify(item)]),
  );
  const next = new Map(
    replacement.items.map((item) => [item.id, JSON.stringify(item)]),
  );
  const changes = { added: 0, updated: 0, removed: 0 };
  for (const [id, text] of next) {
    if (!original.has(id)) changes.added++;
    else if (original.get(id) !== text) changes.updated++;
  }
  for (const id of original.keys()) {
    if (!next.has(id)) changes.removed++;
  }
  const lists = {
    current: "Current",
    next: "Next",
    idea: "Ideas",
    project: "Projects",
  } as const;
  return {
    ...changes,
    changedLists: (["current", "next", "idea", "project"] as const)
      .filter(
        (list) =>
          JSON.stringify(current.orders[list]) !==
          JSON.stringify(replacement.orders[list]),
      )
      .map((list) => lists[list]),
    categoriesChanged:
      JSON.stringify(current.categories) !==
      JSON.stringify(replacement.categories),
  };
}
