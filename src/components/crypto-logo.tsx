"use client";

import { useState } from "react";
import { cryptoMeta } from "@/lib/crypto-meta";

export function CryptoLogo({
  symbol,
  size = 20,
  className = "",
}: {
  symbol: string;
  size?: number;
  className?: string;
}) {
  const meta = cryptoMeta(symbol);
  const [failed, setFailed] = useState(!meta.logo);
  const letter = (meta.label || symbol).slice(0, 1).toUpperCase();

  if (failed) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ${className}`}
        style={{
          width: size,
          height: size,
          background: meta.color,
        }}
        aria-hidden
      >
        {letter}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={meta.logo}
      alt=""
      width={size}
      height={size}
      className={`inline-block shrink-0 rounded-full bg-background object-cover ${className}`}
      style={{ width: size, height: size }}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function CryptoName({
  symbol,
  size = 18,
  showLabel = false,
}: {
  symbol: string;
  size?: number;
  showLabel?: boolean;
}) {
  const meta = cryptoMeta(symbol);
  return (
    <span className="inline-flex items-center gap-1.5">
      <CryptoLogo symbol={symbol} size={size} />
      <span className="font-medium">{symbol}</span>
      {showLabel ? (
        <span className="text-xs text-muted-foreground">{meta.label}</span>
      ) : null}
    </span>
  );
}
