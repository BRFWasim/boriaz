import { cn } from "@/lib/utils";

export function Ornament({ className }: { className?: string }) {
  return (
    <div
      className={cn("flex items-center justify-center gap-3", className)}
      aria-hidden="true"
    >
      <span className="h-px w-8 bg-gold/70 sm:w-12" />
      <span className="size-1.5 rotate-45 bg-gold" />
      <span className="h-px w-8 bg-gold/70 sm:w-12" />
    </div>
  );
}
