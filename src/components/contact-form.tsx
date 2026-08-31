"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ContactForm() {
  const [status, setStatus] = useState<"idle" | "error" | "success">("idle");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const email = String(data.get("email") ?? "").trim();
    const body = String(data.get("message") ?? "").trim();

    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || body.length < 10) {
      setStatus("error");
      setMessage(
        "Merci de renseigner un nom, un e-mail valide et un message d'au moins dix caractères."
      );
      return;
    }

    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    setSubmitting(false);
    setStatus("success");
    setMessage("");
    event.currentTarget.reset();
  }

  if (status === "success") {
    return (
      <div className="border border-border bg-card px-6 py-16 text-center">
        <CheckCircle2 className="mx-auto size-10 text-gold" />
        <h2 className="mt-4 font-serif text-3xl">Message reçu</h2>
        <p className="mx-auto mt-3 max-w-sm text-sm text-muted-foreground">
          Nous vous répondons sous 24 heures ouvées. Pour un rendez-vous urgent,
          appelez l&apos;institut.
        </p>
        <Button className="btn-couture mt-8" onClick={() => setStatus("idle")}>
          Écrire un autre message
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="border border-border bg-card p-6 sm:p-8" noValidate>
      <h2 className="font-serif text-3xl">Laisser un mot</h2>
      <div className="mt-6 flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="contact-name" className="text-[0.7rem] tracking-[0.16em] uppercase">
            Nom
          </Label>
          <Input id="contact-name" name="name" className="h-11 rounded-none" autoComplete="name" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="contact-email" className="text-[0.7rem] tracking-[0.16em] uppercase">
            E-mail
          </Label>
          <Input
            id="contact-email"
            name="email"
            type="email"
            className="h-11 rounded-none"
            autoComplete="email"
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="contact-message" className="text-[0.7rem] tracking-[0.16em] uppercase">
            Message
          </Label>
          <Textarea
            id="contact-message"
            name="message"
            className="min-h-36 rounded-none"
            placeholder="Carte cadeau, question sur un protocole, disponibilité de groupe…"
          />
        </div>
      </div>
      {status === "error" ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {message}
        </p>
      ) : null}
      <Button type="submit" disabled={submitting} className="btn-couture mt-6">
        {submitting ? "Envoi en cours…" : "Envoyer"}
      </Button>
    </form>
  );
}
