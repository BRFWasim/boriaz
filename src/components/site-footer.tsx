import Link from "next/link";
import { site } from "@/lib/data";
import { Ornament } from "@/components/ornament";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t border-border bg-primary text-primary-foreground">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <p className="font-serif text-3xl tracking-[0.16em]">
            {site.name.toUpperCase()}
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-primary-foreground/70">
            {site.claim}. Soins visage, rituels corps, regard et manucure, dans
            une maison confidentielle du 7<sup>e</sup> arrondissement.
          </p>
          <Ornament className="mt-6 justify-start [&_span]:bg-gold" />
        </div>

        <div>
          <p className="label-kicker">Maison</p>
          <ul className="mt-4 space-y-2 text-sm text-primary-foreground/75">
            <li>
              <Link href="/soins" className="hover:text-gold-soft">
                Les soins
              </Link>
            </li>
            <li>
              <Link href="/carte" className="hover:text-gold-soft">
                La carte
              </Link>
            </li>
            <li>
              <Link href="/institut" className="hover:text-gold-soft">
                L&apos;institut
              </Link>
            </li>
            <li>
              <Link href="/reserver" className="hover:text-gold-soft">
                Réserver
              </Link>
            </li>
            <li>
              <Link href="/contact" className="hover:text-gold-soft">
                Contact
              </Link>
            </li>
          </ul>
        </div>

        <div>
          <p className="label-kicker">Venir</p>
          <address className="mt-4 not-italic text-sm leading-relaxed text-primary-foreground/75">
            {site.address}
            <br />
            {site.postal}
            <br />
            <a href={site.phoneHref} className="hover:text-gold-soft">
              {site.phone}
            </a>
            <br />
            <a href={`mailto:${site.email}`} className="hover:text-gold-soft">
              {site.email}
            </a>
          </address>
        </div>
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-5 text-xs tracking-wide text-primary-foreground/50 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>© {new Date().getFullYear()} {site.name}. Tous droits réservés.</p>
          <p>Soins sur rendez-vous · Paris 7<sup>e</sup></p>
        </div>
      </div>
    </footer>
  );
}
