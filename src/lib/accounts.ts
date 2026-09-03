import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { kvBackend, kvGet, kvSet } from "./kv";
import { promises as fs } from "fs";
import { dataPath, ensureDataDir } from "./data-dir";

export interface SimUser {
  id: string;
  name: string;
  pinHash: string;
  createdAt: number;
  bankrollEur: number;
  guest: boolean;
}

const USERS_KEY = "boriazbot:users";
const COOKIE = "bb_user";
const memUsers = new Map<string, SimUser>();

function hashPin(pin: string, id: string): string {
  return createHash("sha256").update(`${id}:${pin}`).digest("hex").slice(0, 32);
}

async function readUsers(): Promise<Record<string, SimUser>> {
  if (kvBackend() === "upstash") {
    const raw = await kvGet(USERS_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as Record<string, SimUser>;
      } catch {
        // fallthrough
      }
    }
  }
  try {
    const raw = await fs.readFile(dataPath(".users.json"), "utf8");
    return JSON.parse(raw) as Record<string, SimUser>;
  } catch {
    if (memUsers.size) {
      return Object.fromEntries(memUsers);
    }
    return {};
  }
}

async function writeUsers(users: Record<string, SimUser>): Promise<void> {
  for (const u of Object.values(users)) memUsers.set(u.id, u);
  const raw = JSON.stringify(users);
  if (kvBackend() === "upstash") await kvSet(USERS_KEY, raw);
  try {
    await ensureDataDir();
    await fs.writeFile(dataPath(".users.json"), raw, "utf8");
  } catch {
    // mémoire
  }
}

export async function getUser(id: string): Promise<SimUser | null> {
  const users = await readUsers();
  return users[id] ?? memUsers.get(id) ?? null;
}

export async function createGuest(): Promise<SimUser> {
  const id = `u_${randomBytes(8).toString("hex")}`;
  const user: SimUser = {
    id,
    name: `Invité-${id.slice(-4)}`,
    pinHash: "",
    createdAt: Date.now(),
    bankrollEur: 1000,
    guest: true,
  };
  const users = await readUsers();
  users[id] = user;
  await writeUsers(users);
  return user;
}

export async function registerUser(
  name: string,
  pin: string,
  existingId?: string,
): Promise<SimUser> {
  const clean = name.trim().slice(0, 24);
  const digits = pin.replace(/\D/g, "").slice(0, 6);
  if (clean.length < 2) throw new Error("Pseudo trop court (2+ lettres)");
  if (digits.length < 4) throw new Error("Code à 4 chiffres minimum");

  const users = await readUsers();
  const taken = Object.values(users).find(
    (u) => !u.guest && u.name.toLowerCase() === clean.toLowerCase(),
  );
  if (taken) throw new Error("Ce pseudo existe déjà — connecte-toi");

  const id = existingId && users[existingId] ? existingId : `u_${randomBytes(8).toString("hex")}`;
  const user: SimUser = {
    id,
    name: clean,
    pinHash: hashPin(digits, id),
    createdAt: users[id]?.createdAt ?? Date.now(),
    bankrollEur: users[id]?.bankrollEur ?? 1000,
    guest: false,
  };
  users[id] = user;
  await writeUsers(users);
  return user;
}

export async function loginUser(name: string, pin: string): Promise<SimUser> {
  const users = await readUsers();
  const user = Object.values(users).find(
    (u) => !u.guest && u.name.toLowerCase() === name.trim().toLowerCase(),
  );
  if (!user) throw new Error("Compte introuvable");
  const digits = pin.replace(/\D/g, "");
  if (user.pinHash !== hashPin(digits, user.id)) {
    throw new Error("Code incorrect");
  }
  return user;
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, userId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 400,
    sameSite: "lax",
    httpOnly: false,
  });
}

/** Crée un invité si pas de cookie — le paper reste au refresh. */
export async function ensureSession(): Promise<SimUser> {
  const store = await cookies();
  const id = store.get(COOKIE)?.value;
  if (id) {
    const user = await getUser(id);
    if (user) return user;
  }
  const guest = await createGuest();
  await setSessionCookie(guest.id);
  return guest;
}

export function publicUser(user: SimUser) {
  return {
    id: user.id,
    name: user.name,
    guest: user.guest,
    bankrollEur: user.bankrollEur,
    createdAt: user.createdAt,
  };
}
