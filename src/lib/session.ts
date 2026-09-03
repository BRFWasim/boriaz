import { ensureSession, type SimUser } from "./accounts";
import { setPersistUser } from "./persist";

export async function bindSession(): Promise<SimUser> {
  const user = await ensureSession();
  setPersistUser(user.id);
  return user;
}

export function bindDefaultBot(): void {
  setPersistUser("default");
}
