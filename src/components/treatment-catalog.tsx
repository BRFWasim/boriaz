"use client";

import Link from "next/link";
import { useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { TreatmentCard } from "@/components/treatment-card";
import { categories, treatments, type TreatmentCategory } from "@/lib/data";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export function TreatmentCatalog() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const current = searchParams.get("categorie") as TreatmentCategory | null;

  const filtered = useMemo(() => {
    if (!current) return treatments;
    return treatments.filter((item) => item.category === current);
  }, [current]);

  function setCategory(slug: TreatmentCategory | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (slug) params.set("categorie", slug);
    else params.delete("categorie");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <FilterChip active={!current} onClick={() => setCategory(null)}>
          Tous les soins
        </FilterChip>
        {categories.map((category) => (
          <FilterChip
            key={category.slug}
            active={current === category.slug}
            onClick={() => setCategory(category.slug)}
          >
            {category.label}
          </FilterChip>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="mt-12 border border-dashed border-border bg-card px-6 py-16 text-center">
          <p className="font-serif text-2xl">Aucun soin dans cette catégorie</p>
          <p className="mt-2 text-sm text-muted-foreground">
            Essayez un autre filtre, ou parcourez toute la carte.
          </p>
          <Button className="btn-couture mt-6" onClick={() => setCategory(null)}>
            Voir tous les soins
          </Button>
        </div>
      ) : (
        <div className="mt-10 grid gap-6 sm:grid-cols-2">
          {filtered.map((treatment) => (
            <TreatmentCard key={treatment.slug} treatment={treatment} />
          ))}
        </div>
      )}

      <p className="mt-10 text-center text-sm text-muted-foreground">
        Une hésitation ?{" "}
        <Link href="/contact" className="text-foreground underline underline-offset-4">
          Écrivez-nous
        </Link>{" "}
        : nous vous orienterons vers le protocole juste.
      </p>
    </div>
  );
}

function FilterChip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border px-4 py-2 text-[0.68rem] tracking-[0.18em] uppercase transition-colors",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:border-foreground/30 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
