import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Ornament } from "@/components/ornament";
import { TreatmentCard } from "@/components/treatment-card";
import { faqs, site, testimonials, treatments, values } from "@/lib/data";
import { FaqList } from "@/components/faq-list";

export default function HomePage() {
  const featured = treatments.filter((item) => item.featured);

  return (
    <>
      <section className="relative isolate min-h-[88vh] overflow-hidden bg-ink text-ivory">
        <Image
          src="https://images.unsplash.com/photo-1616394584738-fc6e612e71b9?auto=format&fit=crop&w=2000&q=80"
          alt="Soin visage dans une cabine de la Maison Liora"
          fill
          priority
          className="object-cover object-[center_20%] opacity-55"
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/55 to-ink/30" />
        <div className="relative mx-auto flex min-h-[88vh] max-w-6xl flex-col justify-end px-4 pb-16 pt-28 sm:px-6 sm:pb-24">
          <p className="label-kicker text-gold-soft">
            Institut de beauté — Paris VII
          </p>
          <h1 className="mt-5 max-w-3xl font-serif text-5xl leading-[1.05] sm:text-6xl md:text-7xl">
            {site.tagline}
          </h1>
          <p className="mt-5 max-w-xl text-base leading-relaxed text-ivory/80 sm:text-lg">
            Des protocoles sur-mesure, des cabines confidentielles, un temps
            véritable. La Maison Liora reçoit sur rendez-vous, rue des
            Saints-Pères.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button
              nativeButton={false}
              render={<Link href="/reserver" />}
              className="btn-couture border border-gold bg-gold text-ink hover:bg-gold-soft"
            >
              Prendre rendez-vous
            </Button>
            <Button
              nativeButton={false}
              render={<Link href="/soins" />}
              variant="outline"
              className="btn-couture border-ivory/40 bg-transparent text-ivory hover:bg-ivory/10 hover:text-ivory"
            >
              Découvrir les soins
            </Button>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <p className="label-kicker">La Maison</p>
          <h2 className="mt-4 font-serif text-4xl sm:text-5xl">
            Une cabine, un visage, un silence.
          </h2>
          <Ornament className="mt-6 justify-start" />
          <p className="mt-6 max-w-xl text-base leading-relaxed text-muted-foreground">
            Liora n&apos;est pas un spa d&apos;hôtel. C&apos;est une maison de
            beauté, tenue par trois praticiennes, où chaque soin commence par un
            diagnostic et se termine sans panier forcé. Nous travaillons le
            visage, le regard, les mains et le corps — avec des formules rares et
            des gestes lents.
          </p>
          <Button
            nativeButton={false}
            render={<Link href="/institut" />}
            variant="outline"
            className="btn-couture mt-8"
          >
            L&apos;esprit de l&apos;institut
          </Button>
        </div>
        <div className="relative aspect-[4/5] overflow-hidden bg-muted">
          <Image
            src="https://images.unsplash.com/photo-1560750588-73207b1ef5bf?auto=format&fit=crop&w=1200&q=80"
            alt="Intérieur feutré de l'institut"
            fill
            className="object-cover"
            sizes="(min-width: 1024px) 40vw, 100vw"
          />
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
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="label-kicker">Signatures</p>
            <h2 className="mt-3 font-serif text-4xl sm:text-5xl">
              Les rituels de la Maison
            </h2>
          </div>
          <Button
            nativeButton={false}
            render={<Link href="/soins" />}
            variant="outline"
            className="btn-couture"
          >
            Toute la carte
          </Button>
        </div>
        <div className="mt-12 grid gap-8">
          {featured.map((treatment) => (
            <TreatmentCard key={treatment.slug} treatment={treatment} featured />
          ))}
        </div>
      </section>

      <section className="bg-primary py-20 text-primary-foreground">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <p className="label-kicker text-gold">Elles en parlent</p>
          <h2 className="mt-3 font-serif text-4xl">La confiance se tisse.</h2>
          <div className="mt-12 grid gap-8 md:grid-cols-3">
            {testimonials.map((item) => (
              <blockquote
                key={item.author}
                className="border border-white/10 bg-white/5 p-6"
              >
                <p className="font-serif text-xl leading-relaxed text-ivory/95">
                  « {item.quote} »
                </p>
                <footer className="mt-6 text-sm text-gold-soft">
                  {item.author}
                  <span className="block text-primary-foreground/50">
                    {item.detail}
                  </span>
                </footer>
              </blockquote>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
        <p className="label-kicker">Questions</p>
        <h2 className="mt-3 font-serif text-4xl">Avant de venir</h2>
        <div className="mt-8">
          <FaqList items={faqs.slice(0, 4)} />
        </div>
      </section>

      <section className="border-t border-border bg-[linear-gradient(180deg,oklch(0.94_0.018_82),oklch(0.97_0.012_85))]">
        <div className="mx-auto max-w-6xl px-4 py-20 text-center sm:px-6">
          <p className="label-kicker">Rendez-vous</p>
          <h2 className="mt-4 font-serif text-4xl sm:text-5xl">
            Offrez-vous un temps juste.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-muted-foreground">
            {site.address}, {site.postal}. Mardi au samedi, dimanche sur
            rendez-vous. {site.phone}.
          </p>
          <Button
            nativeButton={false}
            render={<Link href="/reserver" />}
            className="btn-couture mt-8"
          >
            Réserver une cabine
          </Button>
        </div>
      </section>
    </>
  );
}
