import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { PageHero } from "@/components/page-hero";
import { Ornament } from "@/components/ornament";
import { Button } from "@/components/ui/button";
import { team, values } from "@/lib/data";

export const metadata: Metadata = {
  title: "L'institut",
  description:
    "Maison Liora, institut de beauté confidentiel à Paris 7e. L'équipe, l'esprit, la maison.",
};

export default function InstitutPage() {
  return (
    <>
      <PageHero
        kicker="L'institut"
        title="Trois praticiennes, une maison."
        intro="Camille a ouvert Liora pour retrouver ce qui manque trop souvent : le temps, le diagnostic, le silence. Pas de machines en vitrine. Un salon, trois cabines, une lumière douce."
      />

      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
        <div className="relative aspect-[4/5] overflow-hidden bg-muted">
          <Image
            src="https://images.unsplash.com/photo-1600334129128-685c5582fd35?auto=format&fit=crop&w=1400&q=80"
            alt="Espace d'accueil de la Maison Liora"
            fill
            className="object-cover"
            sizes="(min-width: 1024px) 50vw, 100vw"
          />
        </div>
        <div>
          <p className="label-kicker">L&apos;esprit</p>
          <h2 className="mt-3 font-serif text-4xl">Le 7e, sans le tapage.</h2>
          <Ornament className="mt-6 justify-start" />
          <p className="mt-6 text-base leading-relaxed text-muted-foreground">
            Rue des Saints-Pères, un immeuble sobre, un interphone. On monte, on
            se déchausse, on s&apos;assoit. Le thé est infusé, jamais en sachet.
            Les rendez-vous ne se chevauchent pas : vous n&apos;entendez pas la
            cabine voisine, et nous n&apos;avons pas à vous faire attendre.
          </p>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            Les formules viennent d&apos;un petit nombre de laboratoires
            européens, choisis pour leurs textures et leurs listes. Nous les
            testons d&apos;abord sur nous. Si un actif ne tient pas sa promesse,
            il sort de la cabine.
          </p>
        </div>
      </section>

      <section className="border-y border-border bg-secondary/40">
        <div className="mx-auto grid max-w-6xl gap-10 px-4 py-16 sm:px-6 md:grid-cols-3">
          {values.map((value, index) => (
            <article key={value.title}>
              <p className="label-kicker">{String(index + 1).padStart(2, "0")}</p>
              <h3 className="mt-3 font-serif text-2xl">{value.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                {value.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
        <p className="label-kicker">L&apos;équipe</p>
        <h2 className="mt-3 font-serif text-4xl">Celles qui vous reçoivent</h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {team.map((member) => (
            <article key={member.name} className="border border-border bg-card">
              <div className="relative aspect-[4/5] bg-muted">
                <Image
                  src={member.image}
                  alt={member.name}
                  fill
                  className="object-cover"
                  sizes="(min-width: 768px) 30vw, 100vw"
                />
              </div>
              <div className="p-6">
                <h3 className="font-serif text-2xl">{member.name}</h3>
                <p className="mt-1 text-[0.7rem] tracking-[0.18em] uppercase text-gold">
                  {member.role}
                </p>
                <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                  {member.bio}
                </p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="border-t border-border px-4 py-16 text-center sm:px-6">
        <h2 className="font-serif text-3xl sm:text-4xl">
          Venez sans maquillage, si vous pouvez.
        </h2>
        <p className="mx-auto mt-4 max-w-lg text-muted-foreground">
          Nous prenons dix minutes de plus à la première visite. Le reste est
          déjà prêt : cabine, linge, silence.
        </p>
        <Button
          nativeButton={false}
          render={<Link href="/reserver" />}
          className="btn-couture mt-8"
        >
          Prendre rendez-vous
        </Button>
      </section>
    </>
  );
}
