import { getMacroCalendar } from "@/lib/macro";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const payload = await getMacroCalendar();
    return Response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Macro indisponible";
    return Response.json({ error: message }, { status: 502 });
  }
}
