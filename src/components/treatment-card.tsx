import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
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
        "group flex h-full flex-col overflow-hidden border border-border bg-card",
        featured && "md:flex-row"
      )}
    >
      <div
        className={cn(
          "relative aspect-[4/5] overflow-hidden bg-muted",
          featured && "md:aspect-auto md:w-[46%] md:min-h-[22rem]"
        )}
      >
        <Image
          src={treatment.image}
          alt={treatment.name}
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
        <div className="mt-6 flex flex-wrap gap-3">
          <Button
            nativeButton={false}
            render={<Link href={`/soins/${treatment.slug}`} />}
            variant="outline"
            className="btn-couture border-foreground/20"
          >
            Découvrir
          </Button>
          <Button
            nativeButton={false}
            render={<Link href={`/reserver?soin=${treatment.slug}`} />}
            className="btn-couture"
          >
            Réserver
          </Button>
        </div>
      </div>
    </article>
  );
}
