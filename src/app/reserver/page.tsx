import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHero } from "@/components/page-hero";
import { BookingForm } from "@/components/booking-form";
import { site } from "@/lib/data";

export const metadata: Metadata = {
  title: "Réserver",
  description:
    "Demande de rendez-vous à la Maison Liora, institut de beauté Paris 7e.",
};

export default function ReserverPage() {
  return (
    <>
      <PageHero
        kicker="Agenda"
        title="Demander un rendez-vous"
        intro="Indiquez le soin, le jour et le créneau. Nous confirmons sous 24 heures ouvées. L'institut est fermé le lundi. Première visite : prévoyez dix minutes de plus."
      />
      <section className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_0.7fr]">
        <Suspense
          fallback={
            <div className="border border-border bg-card px-6 py-16 text-center text-sm text-muted-foreground">
              Préparation du formulaire…
            </div>
          }
        >
          <BookingForm />
        </Suspense>
        <aside className="h-fit border border-border bg-secondary/40 p-6 sm:p-8">
          <p className="label-kicker">Horaires</p>
          <ul className="mt-5 space-y-3 text-sm">
            {site.hours.map((row) => (
              <li key={row.days} className="flex justify-between gap-4">
                <span>{row.days}</span>
                <span className="text-muted-foreground">{row.time}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm leading-relaxed text-muted-foreground">
            {site.address}
            <br />
            {site.postal}
            <br />
            Métro Saint-Germain-des-Prés ou Rue du Bac.
          </p>
          <p className="mt-6 text-sm">
            <a href={site.phoneHref} className="underline underline-offset-4">
              {site.phone}
            </a>
            <br />
            <a href={`mailto:${site.email}`} className="underline underline-offset-4">
              {site.email}
            </a>
          </p>
        </aside>
      </section>
    </>
  );
}
