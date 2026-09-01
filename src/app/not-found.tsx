import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-svh max-w-lg flex-col items-center justify-center px-4 text-center">
      <p className="text-xs tracking-[0.22em] text-primary uppercase">404</p>
      <h1 className="mt-4 text-3xl font-semibold">Page introuvable</h1>
      <p className="mt-3 text-muted-foreground">
        Ce tableau de bord n’a qu’une page : le suivi des baleines Hyperliquid.
      </p>
      <Button nativeButton={false} render={<Link href="/" />} className="mt-8">
        Retour au dashboard
      </Button>
    </div>
  );
}
