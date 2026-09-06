"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/site-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const json = (await res.json()) as { error?: string; ok?: boolean };
      if (!res.ok) {
        setError(json.error || "Accès refusé");
        return;
      }
      router.replace(next.startsWith("/") ? next : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16">
      <p className="text-[0.65rem] tracking-[0.28em] text-emerald-500/90 uppercase">
        BoriazBot
      </p>
      <h1 className="font-[family-name:var(--font-heading)] mt-2 text-3xl font-bold tracking-tight">
        Accès privé
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Mot de passe site pour l’interface. Le bot / cron continue de tourner en
        fond sans cette page.
      </p>

      <form onSubmit={onSubmit} className="mt-8 space-y-4">
        <label className="block text-sm">
          <span className="text-muted-foreground">Mot de passe</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1.5 w-full rounded-xl border border-border/70 bg-card/60 px-3 py-2.5 text-sm outline-none ring-emerald-500/40 focus:ring-2"
            placeholder="••••••••"
          />
        </label>
        {error ? (
          <p className="text-sm text-rose-400" role="alert">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !password}
          className="w-full rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
        >
          {busy ? "Vérification…" : "Entrer"}
        </button>
      </form>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto flex min-h-full max-w-md flex-col justify-center px-6 py-16 text-sm text-muted-foreground">
          Chargement…
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
