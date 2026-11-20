import { NextResponse } from "next/server";
import { errorResponse, parseBody } from "@/lib/api";
import { commandSchema } from "@/lib/workshop/model";
import { readWorkshop, writeWorkshop } from "@/lib/workshop/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  try {
    return NextResponse.json(readWorkshop());
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { hash, command } = await parseBody(request, commandSchema);
    return NextResponse.json(await writeWorkshop(hash, command));
  } catch (error) {
    return errorResponse(error);
  }
}
