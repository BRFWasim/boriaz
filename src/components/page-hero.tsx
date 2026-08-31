import { Ornament } from "@/components/ornament";

export function PageHero({
  kicker,
  title,
  intro,
}: {
  kicker: string;
  title: string;
  intro?: string;
}) {
  return (
    <section className="border-b border-border bg-[linear-gradient(180deg,oklch(0.94_0.018_82),oklch(0.97_0.012_85))]">
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 sm:py-20">
        <p className="label-kicker">{kicker}</p>
        <h1 className="mt-4 max-w-3xl font-serif text-4xl leading-[1.1] text-foreground sm:text-5xl md:text-6xl">
          {title}
        </h1>
        {intro ? (
          <p className="mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            {intro}
          </p>
        ) : null}
        <Ornament className="mt-8 justify-start" />
      </div>
    </section>
  );
}
