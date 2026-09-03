import { readJournal } from "@/lib/persist";
import { bindUserRequest } from "@/lib/bind-request";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  await bindUserRequest();
  const url = new URL(request.url);
  const limit = Math.min(100, Number(url.searchParams.get("limit") || 40));
  const entries = await readJournal(limit);
  return Response.json({ entries, fetchedAt: Date.now() });
}
