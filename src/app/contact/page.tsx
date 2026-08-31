import type { Metadata } from "next";
import { PageHero } from "@/components/page-hero";
import { ContactForm } from "@/components/contact-form";
import { FaqList } from "@/components/faq-list";
import { faqs, site } from "@/lib/data";

export const metadata: Metadata = {
  title: "Contact",
  description:
    "Adresse, horaires et message à la Maison Liora, Paris 7e.",
};

export default function ContactPage() {
  return (
    <>
      <PageHero
        kicker="Contact"
        title="Écrire à la Maison"
        intro="Pour une carte cadeau, une question de protocole ou un rendez-vous de groupe, le formulaire suffit. L'urgence se règle au téléphone."
      />
      <section className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-2">
        <div>
          <h2 className="font-serif text-3xl">Venir</h2>
          <address className="mt-5 not-italic text-base leading-relaxed text-muted-foreground">
            {site.name}
            <br />
            {site.address}
            <br />
            {site.postal}
          </address>
          <p className="mt-4 text-sm text-muted-foreground">
            Interphone « Liora ». 2<sup>e</sup> étage, gauche. Ascenseur.
          </p>
          <ul className="mt-8 space-y-2 text-sm">
            {site.hours.map((row) => (
              <li key={row.days} className="flex justify-between gap-6 border-b border-border py-2">
                <span>{row.days}</span>
                <span className="text-muted-foreground">{row.time}</span>
              </li>
            ))}
          </ul>
          <p className="mt-8 text-sm">
            <a className="underline underline-offset-4" href={site.phoneHref}>
              {site.phone}
            </a>
            <br />
            <a className="underline underline-offset-4" href={`mailto:${site.email}`}>
              {site.email}
            </a>
          </p>
          <div className="mt-10 aspect-[16/10] border border-border bg-secondary/60 p-6">
            <p className="label-kicker">Plan</p>
            <p className="mt-3 font-serif text-2xl">Saint-Germain-des-Prés</p>
            <p className="mt-2 max-w-sm text-sm text-muted-foreground">
              Métro ligne 4, Saint-Germain-des-Prés. Bus 39, 63, 95. Stationnement
              difficile : préférez les transports.
            </p>
          </div>
        </div>
        <ContactForm />
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-6">
        <h2 className="font-serif text-3xl">Questions fréquentes</h2>
        <div className="mt-6">
          <FaqList items={faqs} />
        </div>
      </section>
    </>
  );
}
