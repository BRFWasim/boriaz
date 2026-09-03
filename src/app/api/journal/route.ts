import { readJournal } from "@/lib/persist";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(100, Number(url.searchParams.get("limit") || 40));
  const entries = await readJournal(limit);
  return Response.json({ entries, fetchedAt: Date.now() });
}
