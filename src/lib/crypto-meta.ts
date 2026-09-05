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
    logo: "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/uni.png",
    color: "#FF007A",
  },
  UNISWAP: {
    label: "Uniswap",
    logo: "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/uni.png",
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
  AVAX: {
    label: "Avalanche",
    logo: "https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png",
    color: "#E84142",
  },
  LINK: {
    label: "Chainlink",
    logo: "https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png",
    color: "#2A5ADA",
  },
  DOGE: {
    label: "Dogecoin",
    logo: "https://assets.coingecko.com/coins/images/5/small/dogecoin.png",
    color: "#C2A633",
  },
  SUI: {
    label: "Sui",
    logo: "https://assets.coingecko.com/coins/images/26375/small/sui-ocean-square.png",
    color: "#4DA2FF",
  },
  NEAR: {
    label: "NEAR",
    logo: "https://assets.coingecko.com/coins/images/10365/small/near.jpg",
    color: "#000000",
  },
  APT: {
    label: "Aptos",
    logo: "https://assets.coingecko.com/coins/images/26455/small/aptos_round.png",
    color: "#2DD8A9",
  },
  SEI: {
    label: "Sei",
    logo: "https://assets.coingecko.com/coins/images/28205/small/Sei_Logo_-_Transparent.png",
    color: "#9B1C1C",
  },
  FET: {
    label: "Fetch.ai",
    logo: "https://assets.coingecko.com/coins/images/5681/small/Fetch.jpg",
    color: "#1E90FF",
  },
  AAVE: {
    label: "Aave",
    logo: "https://assets.coingecko.com/coins/images/12645/small/aave-token-round.png",
    color: "#B6509E",
  },
  PENDLE: {
    label: "Pendle",
    logo: "https://assets.coingecko.com/coins/images/15069/small/Pendle_Logo_Normal-03.png",
    color: "#1DB8A4",
  },
  TIA: {
    label: "Celestia",
    logo: "https://assets.coingecko.com/coins/images/31967/small/tia.jpg",
    color: "#7B2BFF",
  },
  INJ: {
    label: "Injective",
    logo: "https://assets.coingecko.com/coins/images/12882/small/Secondary_Symbol.png",
    color: "#00F2FE",
  },
  PEPE: {
    label: "Pepe",
    logo: "https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg",
    color: "#3D9A3C",
  },
  kPEPE: {
    label: "Pepe",
    logo: "https://assets.coingecko.com/coins/images/29850/small/pepe-token.jpeg",
    color: "#3D9A3C",
  },
  PUMP: {
    label: "Pump.fun",
    logo: "https://assets.coingecko.com/coins/images/53097/small/pump.jpg",
    color: "#00D4AA",
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

const FALLBACKS: Record<string, string[]> = {
  UNI: [
    "https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/uni.png",
    "https://cryptologos.cc/logos/uniswap-uni-logo.png",
    "https://assets.coincap.io/assets/icons/uni@2x.png",
  ],
};

export function logoFallbacks(symbol: string): string[] {
  const key = symbol.toUpperCase();
  const primary = cryptoMeta(symbol).logo;
  const extra = FALLBACKS[key] ?? FALLBACKS[key.replace(/^U/, "")] ?? [];
  return [primary, ...extra].filter((u, i, a) => u && a.indexOf(u) === i);
}
