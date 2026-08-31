"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { site } from "@/lib/data";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Accueil" },
  { href: "/soins", label: "Soins" },
  { href: "/carte", label: "Carte" },
  { href: "/institut", label: "L'institut" },
  { href: "/contact", label: "Contact" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const onHome = pathname === "/";

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b",
        onHome
          ? "border-white/10 bg-ink/70 text-ivory backdrop-blur-md"
          : "border-border/80 bg-ivory/90 text-foreground backdrop-blur-md"
      )}
    >
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:h-[4.5rem] sm:px-6">
        <Link href="/" className="group flex flex-col leading-none">
          <span
            className={cn(
              "font-serif text-xl tracking-[0.18em] sm:text-[1.35rem]",
              onHome ? "text-ivory" : "text-foreground"
            )}
          >
            {site.name.toUpperCase()}
          </span>
          <span
            className={cn(
              "mt-1 text-[0.58rem] tracking-[0.32em] uppercase",
              onHome ? "text-gold-soft" : "text-gold"
            )}
          >
            Paris
          </span>
        </Link>

        <nav className="hidden items-center gap-8 lg:flex" aria-label="Principal">
          {links.map((link) => {
            const active =
              link.href === "/"
                ? pathname === "/"
                : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "text-[0.72rem] tracking-[0.22em] uppercase transition-colors",
                  onHome
                    ? active
                      ? "text-gold-soft"
                      : "text-ivory/75 hover:text-ivory"
                    : active
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <Button
            nativeButton={false}
            render={<Link href="/reserver" />}
            className={cn(
              "btn-couture hidden sm:inline-flex",
              onHome
                ? "border border-gold/80 bg-transparent text-ivory hover:bg-gold hover:text-ink"
                : "bg-primary text-primary-foreground hover:bg-primary/90"
            )}
          >
            Réserver
          </Button>

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className={cn(
                    "lg:hidden",
                    onHome && "text-ivory hover:bg-white/10 hover:text-ivory"
                  )}
                  aria-label="Ouvrir le menu"
                />
              }
            >
              <Menu className="size-5" />
            </SheetTrigger>
            <SheetContent side="right" className="bg-ivory w-[min(100%,20rem)]">
              <SheetHeader>
                <SheetTitle className="font-serif text-2xl tracking-[0.16em]">
                  {site.name}
                </SheetTitle>
              </SheetHeader>
              <nav className="mt-8 flex flex-col gap-1 px-2" aria-label="Mobile">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setOpen(false)}
                    className="px-2 py-3 text-sm tracking-[0.18em] uppercase text-foreground/80 hover:text-foreground"
                  >
                    {link.label}
                  </Link>
                ))}
                <Button
                  nativeButton={false}
                  render={<Link href="/reserver" onClick={() => setOpen(false)} />}
                  className="btn-couture mt-6 bg-primary text-primary-foreground"
                >
                  Réserver
                </Button>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
