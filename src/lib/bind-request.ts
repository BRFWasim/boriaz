import { bindDefaultBot, bindSession } from "./session";
import { followBook, loadPrefs } from "./persist";

export async function bindUserRequest(opts?: { follow?: boolean }): Promise<void> {
  const user = await bindSession();
  if (opts?.follow === false) return;
  const prefs = await loadPrefs();
  await followBook(user.bankrollEur || prefs.paperBankrollEur || 1000);
}

export function bindCronRequest(): void {
  bindDefaultBot();
}
