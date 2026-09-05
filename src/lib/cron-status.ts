import { kvGetJson, kvSetJson } from "@/lib/kv";

const KEY = "boriaz:last-cron-v1";

export type CronStatus = {
  at: number;
  ok: boolean;
  tick?: string;
  note?: string;
};

export async function saveCronStatus(status: CronStatus): Promise<void> {
  await kvSetJson(KEY, status);
}

export async function loadCronStatus(): Promise<CronStatus | null> {
  return kvGetJson<CronStatus>(KEY);
}
