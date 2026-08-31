import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHero } from "@/components/page-hero";
import { TreatmentCatalog } from "@/components/treatment-catalog";

export const metadata: Metadata = {
  title: "Les soins",
  description:
    "Carte des soins Maison Liora : visage, corps, regard, manucure et épilation de précision.",
};

export default function SoinsPage() {
  return (
    <>
      <PageHero
        kicker="La carte"
        title="Des protocoles, pas des menus."
        intro="Chaque soin commence par un diagnostic. Les durées sont tenues, les formules choisies, les cabines jamais empilées. Filtrez par geste, ou laissez-vous guider."
      />
      <section className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6">
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">Chargement de la carte…</p>
          }
        >
          <TreatmentCatalog />
        </Suspense>
      </section>
    </>
  );
}
