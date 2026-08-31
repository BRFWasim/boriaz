import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-1 flex-col items-center justify-center px-4 py-24 text-center">
      <p className="label-kicker">404</p>
      <h1 className="mt-4 font-serif text-4xl sm:text-5xl">Page introuvable</h1>
      <p className="mt-4 text-muted-foreground">
        Cette adresse n&apos;existe pas dans la Maison. Revenez à l&apos;accueil,
        ou parcourez la carte des soins.
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-3">
        <Button nativeButton={false} render={<Link href="/" />} className="btn-couture">
          Accueil
        </Button>
        <Button
          nativeButton={false}
          render={<Link href="/soins" />}
          variant="outline"
          className="btn-couture"
        >
          Les soins
        </Button>
      </div>
    </div>
  );
}
