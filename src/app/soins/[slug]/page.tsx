import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Ornament } from "@/components/ornament";
import {
  categoryLabel,
  formatPrice,
  getTreatment,
  treatments,
} from "@/lib/data";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return treatments.map((treatment) => ({ slug: treatment.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const treatment = getTreatment(slug);
  if (!treatment) return { title: "Soin introuvable" };
  return {
    title: treatment.name,
    description: treatment.short,
  };
}

export default async function TreatmentPage({ params }: Props) {
  const { slug } = await params;
  const treatment = getTreatment(slug);
  if (!treatment) notFound();

  return (
    <>
      <section className="grid lg:grid-cols-2">
        <div className="relative min-h-[50vh] bg-muted lg:min-h-[80vh]">
          <Image
            src={treatment.image}
            alt={treatment.name}
            fill
            priority
            className="object-cover"
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
        </div>
        <div className="flex flex-col justify-center px-6 py-14 sm:px-12 lg:px-16">
          <p className="label-kicker">{categoryLabel(treatment.category)}</p>
          <h1 className="mt-4 font-serif text-4xl sm:text-5xl">{treatment.name}</h1>
          <p className="mt-3 text-sm tracking-wide text-muted-foreground">
            {treatment.duration} · {formatPrice(treatment.price)}
          </p>
          <Ornament className="mt-6 justify-start" />
          <p className="mt-6 max-w-lg text-base leading-relaxed text-foreground/80">
            {treatment.description}
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              nativeButton={false}
              render={<Link href={`/reserver?soin=${treatment.slug}`} />}
              className="btn-couture"
            >
              Réserver ce soin
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/soins" />}
              variant="outline"
              className="btn-couture"
            >
              Retour à la carte
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <p className="label-kicker">Le protocole</p>
        <h2 className="mt-3 font-serif text-3xl">Le déroulé en cabine</h2>
        <ol className="mt-10 grid gap-6 md:grid-cols-2">
          {treatment.protocol.map((step, index) => (
            <li key={step} className="border border-border bg-card p-6">
              <span className="label-kicker">
                {String(index + 1).padStart(2, "0")}
              </span>
              <p className="mt-3 font-serif text-xl leading-snug">{step}</p>
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
