import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  categoryLabel,
  formatPrice,
  type Treatment,
} from "@/lib/data";
import { cn } from "@/lib/utils";

export function TreatmentCard({
  treatment,
  featured = false,
}: {
  treatment: Treatment;
  featured?: boolean;
}) {
  return (
    <article
      className={cn(
        "group relative flex h-full flex-col overflow-hidden border border-border bg-card",
        featured && "md:flex-row"
      )}
    >
      <Link
        href={`/soins/${treatment.slug}`}
        className="absolute inset-0 z-10"
        aria-label={`Découvrir ${treatment.name}`}
      />
      <div
        className={cn(
          "relative aspect-[4/5] overflow-hidden bg-muted",
          featured && "md:aspect-auto md:w-[46%] md:min-h-[22rem]"
        )}
      >
        <Image
          src={treatment.image}
          alt=""
          fill
          sizes="(min-width: 768px) 40vw, 100vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.04]"
        />
      </div>
      <div className={cn("flex flex-1 flex-col p-6 sm:p-8", featured && "md:justify-center")}>
        <p className="label-kicker">{categoryLabel(treatment.category)}</p>
        <h3 className="mt-3 font-serif text-2xl sm:text-3xl">{treatment.name}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {treatment.duration} · {formatPrice(treatment.price)}
        </p>
        <p className="mt-4 flex-1 text-sm leading-relaxed text-foreground/80">
          {treatment.short}
        </p>
        <div className="relative z-20 mt-6 flex flex-wrap gap-3">
          <Link
            href={`/soins/${treatment.slug}`}
            className={cn(
              buttonVariants({ variant: "outline" }),
              "btn-couture border-foreground/20"
            )}
          >
            Découvrir
          </Link>
          <Link
            href={`/reserver?soin=${treatment.slug}`}
            className={cn(buttonVariants(), "btn-couture")}
          >
            Réserver
          </Link>
        </div>
      </div>
    </article>
  );
}
