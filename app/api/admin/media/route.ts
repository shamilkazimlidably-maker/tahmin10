import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/src/lib/env";
import { fetchTelegramFile } from "@/src/sales/inbox";
import { isAuthed } from "../route";

/** Panel için Telegram medya köprüsü: /api/admin/media?file=<file_id>  (yalnızca giriş yapmış yönetici). */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const env = getEnv();
  if (!isAuthed(request, env)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const fileId = request.nextUrl.searchParams.get("file") ?? "";
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(fileId)) return NextResponse.json({ error: "bad file id" }, { status: 400 });
  try {
    const f = await fetchTelegramFile(fileId);
    return new NextResponse(f.bytes, { headers: { "Content-Type": f.contentType, "Content-Disposition": `inline; filename="${f.name}"`, "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 502 });
  }
}
