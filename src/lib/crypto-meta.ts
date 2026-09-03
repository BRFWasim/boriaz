/** Métadonnées + logos officiels (CDN CoinGecko / crypto-icons). */

export const CRYPTO_META: Record<
  string,
  { label: string; logo: string; color: string }
> = {
  BTC: {
    label: "Bitcoin",
    logo: "https://assets.coingecko.com/coins/images/1/small/bitcoin.png",
    color: "#F7931A",
  },
  ETH: {
    label: "Ethereum",
    logo: "https://assets.coingecko.com/coins/images/279/small/ethereum.png",
    color: "#627EEA",
  },
  SOL: {
    label: "Solana",
    logo: "https://assets.coingecko.com/coins/images/4128/small/solana.png",
    color: "#14F195",
  },
  UNI: {
    label: "Uniswap",
    logo: "https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png",
    color: "#FF007A",
  },
  UNISWAP: {
    label: "Uniswap",
    logo: "https://assets.coingecko.com/coins/images/12504/small/uniswap-uni.png",
    color: "#FF007A",
  },
  RENDER: {
    label: "Render",
    logo: "https://assets.coingecko.com/coins/images/11636/small/rndr.png",
    color: "#6C3CE1",
  },
  ONDO: {
    label: "Ondo",
    logo: "https://assets.coingecko.com/coins/images/26580/small/ONDO.png",
    color: "#1A4DFF",
  },
  HYPE: {
    label: "Hyperliquid",
    logo: "https://assets.coingecko.com/coins/images/50882/small/hyperliquid.jpeg",
    color: "#97FCE4",
  },
  TAO: {
    label: "Bittensor",
    logo: "https://assets.coingecko.com/coins/images/28452/small/ARNjpciaCz_D_e6Kj9UdpqJUeOm5Fmeo-wckckGFcA.png",
    color: "#1A1A1A",
  },
  XRP: {
    label: "XRP",
    logo: "https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png",
    color: "#23292F",
  },
  ZEC: {
    label: "Zcash",
    logo: "https://assets.coingecko.com/coins/images/486/small/circle-zcash-color.png",
    color: "#ECB52B",
  },
};

export function cryptoMeta(symbol: string) {
  const key = symbol.replace(/^U/, "").toUpperCase();
  // UBTC → BTC, etc.
  const base = key.startsWith("U") && key.length > 1 && CRYPTO_META[key.slice(1)]
    ? key.slice(1)
    : key;
  return (
    CRYPTO_META[base] ??
    CRYPTO_META[key] ?? {
      label: symbol,
      logo: "",
      color: "#888",
    }
  );
}

export function logoFor(symbol: string): string {
  return cryptoMeta(symbol).logo;
}
