import type { Metadata } from "next";
import Link from "next/link";
import { PageHero } from "@/components/page-hero";
import { Button } from "@/components/ui/button";
import {
  categories,
  formatPrice,
  treatments,
  type TreatmentCategory,
} from "@/lib/data";

export const metadata: Metadata = {
  title: "Carte des tarifs",
  description:
    "Tarifs des soins Maison Liora : visage, corps, regard, manucure et épilation.",
};

export default function CartePage() {
  return (
    <>
      <PageHero
        kicker="Tarifs"
        title="Une carte claire, sans surprises."
        intro="Les prix indiqués comprennent le diagnostic, le protocole et les produits utilisés en cabine. Les forfaits et cartes cadeaux se règlent à l'institut ou par virement."
      />
      <section className="mx-auto w-full max-w-4xl px-4 py-14 sm:px-6">
        {categories.map((category) => (
          <PriceGroup key={category.slug} slug={category.slug} label={category.label} />
        ))}

        <div className="mt-14 border border-border bg-secondary/50 p-8 text-center">
          <p className="font-serif text-2xl">Carte cadeau</p>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Montant libre ou soin nommé, valable un an. Envoi par e-mail ou retrait
            rue des Saints-Pères.
          </p>
          <Button
            nativeButton={false}
            render={<Link href="/contact" />}
            className="btn-couture mt-6"
          >
            Offrir un soin
          </Button>
        </div>
      </section>
    </>
  );
}

function PriceGroup({ slug, label }: { slug: TreatmentCategory; label: string }) {
  const items = treatments.filter((item) => item.category === slug);
  if (items.length === 0) return null;

  return (
    <div className="mb-12">
      <h2 className="font-serif text-3xl">{label}</h2>
      <ul className="mt-5 divide-y divide-border border-y border-border">
        {items.map((item) => (
          <li key={item.slug}>
            <Link
              href={`/soins/${item.slug}`}
              className="flex flex-col gap-1 py-4 transition-colors hover:bg-secondary/40 sm:flex-row sm:items-baseline sm:justify-between sm:gap-6"
            >
              <span>
                <span className="font-serif text-xl">{item.name}</span>
                <span className="mt-1 block text-sm text-muted-foreground">
                  {item.duration} · {item.short}
                </span>
              </span>
              <span className="shrink-0 font-medium tracking-wide">
                {item.slug === "epilation-precision"
                  ? `à partir de ${formatPrice(item.price)}`
                  : formatPrice(item.price)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
