import {
  followWallet,
  loadFollowedWallets,
  unfollowWallet,
} from "@/lib/persist";
import { bindUserRequest } from "@/lib/bind-request";

export const dynamic = "force-dynamic";

export async function GET() {
  await bindUserRequest({ follow: false });
  const wallets = await loadFollowedWallets();
  return Response.json({ wallets, count: wallets.length });
}

export async function POST(request: Request) {
  await bindUserRequest({ follow: false });
  const body = (await request.json().catch(() => ({}))) as {
    address?: string;
    alias?: string;
    action?: "follow" | "unfollow";
  };
  const address = String(body.address || "").trim();
  if (!address || address.length < 10) {
    return Response.json({ error: "Adresse invalide" }, { status: 400 });
  }
  const action = body.action === "unfollow" ? "unfollow" : "follow";
  const wallets =
    action === "unfollow"
      ? await unfollowWallet(address)
      : await followWallet(address, body.alias || address, "manual");
  return Response.json({ ok: true, action, wallets, count: wallets.length });
}
