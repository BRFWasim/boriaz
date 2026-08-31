"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { format, startOfToday } from "date-fns";
import { fr as frDate } from "date-fns/locale";
import { fr } from "react-day-picker/locale";
import { CalendarIcon, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { getTreatment, timeSlots, treatments } from "@/lib/data";
import { cn } from "@/lib/utils";

type FormState = {
  name: string;
  email: string;
  phone: string;
  soin: string;
  date: Date | undefined;
  time: string;
  notes: string;
};

type FieldErrors = Partial<Record<keyof FormState, string>>;

const empty: FormState = {
  name: "",
  email: "",
  phone: "",
  soin: "",
  date: undefined,
  time: "",
  notes: "",
};

export function BookingForm() {
  const searchParams = useSearchParams();
  const preset = searchParams.get("soin") ?? "";
  const [form, setForm] = useState<FormState>({
    ...empty,
    soin: getTreatment(preset) ? preset : "",
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitted, setSubmitted] = useState<FormState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const selectedTreatment = useMemo(
    () => (form.soin ? getTreatment(form.soin) : undefined),
    [form.soin]
  );

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  }

  function validate(values: FormState): FieldErrors {
    const next: FieldErrors = {};
    if (!values.name.trim() || values.name.trim().length < 2) {
      next.name = "Indiquez votre nom complet.";
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email.trim())) {
      next.email = "L'adresse e-mail n'est pas valide.";
    }
    if (!/^(\+33|0)[1-9](\d{2}){4}$/.test(values.phone.replace(/[\s.-]/g, ""))) {
      next.phone = "Indiquez un numéro français, par exemple 06 12 34 56 78.";
    }
    if (!values.soin) next.soin = "Choisissez un soin.";
    if (!values.date) next.date = "Choisissez une date.";
    else if (values.date.getDay() === 1) next.date = "L'institut est fermé le lundi.";
    if (!values.time) next.time = "Choisissez un créneau.";
    return next;
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const nextErrors = validate(form);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    await new Promise((resolve) => setTimeout(resolve, 700));
    setSubmitting(false);
    setSubmitted(form);
  }

  if (submitted) {
    const treatment = getTreatment(submitted.soin);
    return (
      <div className="border border-border bg-card px-6 py-12 text-center sm:px-10">
        <CheckCircle2 className="mx-auto size-10 text-gold" />
        <h2 className="mt-4 font-serif text-3xl">Demande envoyée</h2>
        <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">
          Merci {submitted.name}. Nous confirmons votre {treatment?.name ?? "soin"}
          {submitted.date
            ? ` le ${format(submitted.date, "EEEE d MMMM", { locale: frDate })} à ${submitted.time}`
            : ""}{" "}
          sous 24 heures ouvées, par e-mail à {submitted.email}.
        </p>
        <Button
          className="btn-couture mt-8"
          onClick={() => {
            setSubmitted(null);
            setForm(empty);
          }}
        >
          Nouvelle demande
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="border border-border bg-card p-6 sm:p-8" noValidate>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Nom complet" htmlFor="name" error={errors.name}>
          <Input
            id="name"
            name="name"
            autoComplete="name"
            value={form.name}
            aria-invalid={Boolean(errors.name)}
            onChange={(event) => update("name", event.target.value)}
            className="h-11 rounded-none"
            placeholder="Camille Moreau"
          />
        </Field>
        <Field label="E-mail" htmlFor="email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={form.email}
            aria-invalid={Boolean(errors.email)}
            onChange={(event) => update("email", event.target.value)}
            className="h-11 rounded-none"
            placeholder="vous@exemple.fr"
          />
        </Field>
        <Field label="Téléphone" htmlFor="phone" error={errors.phone}>
          <Input
            id="phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            value={form.phone}
            aria-invalid={Boolean(errors.phone)}
            onChange={(event) => update("phone", event.target.value)}
            className="h-11 rounded-none"
            placeholder="06 12 34 56 78"
          />
        </Field>
        <Field label="Soin" htmlFor="soin" error={errors.soin}>
          <Select
            value={form.soin || null}
            onValueChange={(value) => update("soin", value ?? "")}
          >
            <SelectTrigger
              id="soin"
              className="h-11 w-full rounded-none"
              aria-invalid={Boolean(errors.soin)}
            >
              <SelectValue placeholder="Choisir un soin" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className="max-h-72">
              {treatments.map((treatment) => (
                <SelectItem key={treatment.slug} value={treatment.slug}>
                  {treatment.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Date" htmlFor="date" error={errors.date}>
          <Popover>
            <PopoverTrigger
              render={
                <Button
                  id="date"
                  type="button"
                  variant="outline"
                  className={cn(
                    "h-11 w-full justify-between rounded-none font-normal",
                    !form.date && "text-muted-foreground"
                  )}
                  aria-invalid={Boolean(errors.date)}
                />
              }
            >
              {form.date
                ? format(form.date, "d MMMM yyyy", { locale: frDate })
                : "Choisir une date"}
              <CalendarIcon className="size-4 opacity-60" />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                locale={fr}
                selected={form.date}
                onSelect={(date) => update("date", date)}
                disabled={[{ dayOfWeek: [1] }, { before: startOfToday() }]}
              />
            </PopoverContent>
          </Popover>
        </Field>
        <Field label="Créneau" htmlFor="time" error={errors.time}>
          <Select
            value={form.time || null}
            onValueChange={(value) => update("time", value ?? "")}
          >
            <SelectTrigger
              id="time"
              className="h-11 w-full rounded-none"
              aria-invalid={Boolean(errors.time)}
            >
              <SelectValue placeholder="Choisir un horaire" />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false} className="max-h-72">
              {timeSlots.map((slot) => (
                <SelectItem key={slot} value={slot}>
                  {slot.replace(":", "h")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      {selectedTreatment ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {selectedTreatment.name} · {selectedTreatment.duration} · protocole confirmé
          par l&apos;équipe selon les disponibilités.
        </p>
      ) : null}

      <Field label="Précisions (optionnel)" htmlFor="notes" className="mt-5">
        <Textarea
          id="notes"
          name="notes"
          value={form.notes}
          onChange={(event) => update("notes", event.target.value)}
          className="min-h-28 rounded-none"
          placeholder="Première visite, grossesse, zones d'épilation, carte cadeau…"
        />
      </Field>

      <Button type="submit" disabled={submitting} className="btn-couture mt-8 w-full sm:w-auto">
        {submitting ? "Envoi en cours…" : "Envoyer la demande"}
      </Button>
      <p className="mt-3 text-xs text-muted-foreground">
        La demande n&apos;est pas un rendez-vous confirmé. Nous vous écrivons sous 24 heures
        ouvées. Aucun compte n&apos;est créé.
      </p>
    </form>
  );
}

function Field({
  label,
  htmlFor,
  error,
  children,
  className,
}: {
  label: string;
  htmlFor: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={htmlFor} className="text-[0.7rem] tracking-[0.16em] uppercase">
        {label}
      </Label>
      {children}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
