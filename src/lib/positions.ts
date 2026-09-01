import { parseNum } from "./format";
import type {
  AssetCtx,
  ClosedPosition,
  ExitReason,
  Fill,
  FrontendOrder,
  HistoricalOrder,
  OpenPosition,
  ProtectionLevel,
  Side,
  UniverseAsset,
} from "./types";

const EPS = 1e-10;
const CLUSTER_MS = 90_000;

export function isPerpFill(fill: Fill): boolean {
  if (fill.coin.startsWith("@")) return false;
  const dir = fill.dir ?? "";
  return dir !== "Buy" && dir !== "Sell" && dir !== "Spot Dust Conversion";
}

export function flattenOrders(orders: FrontendOrder[]): FrontendOrder[] {
  const out: FrontendOrder[] = [];
  for (const order of orders) {
    out.push(order);
    if (order.children?.length) {
      out.push(...flattenOrders(order.children));
    }
  }
  return out;
}

export function buildMarkMap(
  universe: UniverseAsset[],
  ctxs: AssetCtx[],
): Map<string, number> {
  const map = new Map<string, number>();
  const n = Math.min(universe.length, ctxs.length);
  for (let i = 0; i < n; i++) {
    const name = universe[i]?.name;
    const px = parseNum(ctxs[i]?.markPx);
    if (name && px > 0) map.set(name, px);
  }
  return map;
}

function classifyTrigger(
  order: FrontendOrder,
  side: Side,
  markPx: number | null,
): ProtectionLevel["kind"] | null {
  if (order.tpsl === "sl" || order.tpsl === "tp") return order.tpsl;
  const type = order.orderType ?? "";
  if (type.toLowerCase().includes("take profit")) return "tp";
  if (type.toLowerCase().startsWith("stop")) return "sl";

  const isTrigger = Boolean(order.isTrigger || order.isPositionTpsl);
  if (!isTrigger) return null;

  const trigger = parseNum(order.triggerPx);
  if (trigger <= 0 || !markPx || markPx <= 0) return null;

  // Un ordre reduce-only déclencheur sous le marché d'un long est un SL, au-dessus un TP.
  if (side === "long") return trigger < markPx ? "sl" : "tp";
  return trigger > markPx ? "sl" : "tp";
}

function isProtectiveOrder(order: FrontendOrder): boolean {
  if (order.tpsl === "sl" || order.tpsl === "tp") return true;
  if (order.isPositionTpsl || order.isTrigger) return true;
  const type = order.orderType ?? "";
  return /stop|take profit/i.test(type);
}

function pickLevel(
  orders: FrontendOrder[],
  kind: "sl" | "tp",
  side: Side,
  markPx: number | null,
): ProtectionLevel | null {
  const matches: ProtectionLevel[] = [];
  for (const order of orders) {
    if (!isProtectiveOrder(order)) continue;
    const classified = classifyTrigger(order, side, markPx);
    if (classified !== kind) continue;
    const price = parseNum(order.triggerPx) || parseNum(order.limitPx);
    if (price <= 0) continue;
    const distancePct =
      markPx && markPx > 0 ? ((price - markPx) / markPx) * 100 : 0;
    matches.push({
      kind,
      price,
      distancePct,
      orderType: order.orderType ?? "Trigger",
      isPositionLevel: Boolean(order.isPositionTpsl),
    });
  }
  if (!matches.length) return null;
  const positionLevel = matches.find((m) => m.isPositionLevel);
  if (positionLevel) return positionLevel;
  if (!markPx) return matches[0];
  return [...matches].sort(
    (a, b) => Math.abs(a.distancePct) - Math.abs(b.distancePct),
  )[0];
}

export function findOpenTime(
  fills: Fill[],
  coin: string,
  signedQty: number,
): { time: number | null; inferred: boolean } {
  const sign = Math.sign(signedQty);
  if (sign === 0) return { time: null, inferred: false };

  const coinFills = fills
    .filter((fill) => fill.coin === coin && isPerpFill(fill))
    .sort((a, b) => b.time - a.time);

  if (!coinFills.length) return { time: null, inferred: false };

  let openTime = coinFills[0].time;
  let foundBoundary = false;
  for (const fill of coinFills) {
    openTime = fill.time;
    const start = parseNum(fill.startPosition);
    if (Math.abs(start) < EPS || Math.sign(start) !== sign) {
      foundBoundary = true;
      break;
    }
  }

  if (!foundBoundary) {
    return { time: null, inferred: false };
  }
  return { time: openTime, inferred: true };
}

export function attachProtections(
  positions: Omit<OpenPosition, "sl" | "tp">[],
  orders: FrontendOrder[],
): OpenPosition[] {
  const flat = flattenOrders(orders);
  return positions.map((position) => {
    const related = flat.filter(
      (order) =>
        order.coin === position.coin &&
        (order.reduceOnly ||
          order.isPositionTpsl ||
          order.isTrigger ||
          order.tpsl),
    );
    return {
      ...position,
      sl: pickLevel(related, "sl", position.side, position.markPx),
      tp: pickLevel(related, "tp", position.side, position.markPx),
    };
  });
}

function detectExitReason(
  fill: Fill,
  histByOid: Map<number, HistoricalOrder>,
): ExitReason {
  const hist = histByOid.get(fill.oid);
  if (!hist) return "manual";
  const order = hist.order;
  const type = order.orderType ?? "";
  if (/take profit/i.test(type) || order.tpsl === "tp") return "tp";
  if (/^stop/i.test(type) || order.tpsl === "sl") return "sl";
  if (order.isTrigger || order.isPositionTpsl) return "trigger";
  return "manual";
}

interface Inventory {
  side: Side;
  qty: number;
  vwap: number;
  openTime: number;
}

function openInv(
  map: Map<string, Inventory>,
  coin: string,
  side: Side,
  qty: number,
  px: number,
  time: number,
) {
  if (qty <= EPS) return;
  const cur = map.get(coin);
  if (!cur || cur.qty <= EPS) {
    map.set(coin, { side, qty, vwap: px, openTime: time });
    return;
  }
  if (cur.side !== side) {
    map.set(coin, { side, qty, vwap: px, openTime: time });
    return;
  }
  const total = cur.qty + qty;
  cur.vwap = (cur.vwap * cur.qty + px * qty) / total;
  cur.qty = total;
}

function pushClosed(
  closed: ClosedPosition[],
  next: ClosedPosition,
) {
  const last = closed[closed.length - 1];
  if (
    last &&
    last.coin === next.coin &&
    last.side === next.side &&
    next.closedAt - last.closedAt <= CLUSTER_MS
  ) {
    const qty = last.qty + next.qty;
    last.exitPx = (last.exitPx * last.qty + next.exitPx * next.qty) / qty;
    last.entryPx = (last.entryPx * last.qty + next.entryPx * next.qty) / qty;
    last.qty = qty;
    last.realizedPnl += next.realizedPnl;
    last.closedAt = next.closedAt;
    if (next.exitReason === "sl" || (next.exitReason === "tp" && last.exitReason === "manual")) {
      last.exitReason = next.exitReason;
    } else if (next.exitReason === "trigger" && last.exitReason === "manual") {
      last.exitReason = "trigger";
    }
    return;
  }
  closed.push(next);
}

function closeInv(
  map: Map<string, Inventory>,
  closed: ClosedPosition[],
  coin: string,
  side: Side,
  qty: number,
  px: number,
  time: number,
  pnl: number,
  reason: ExitReason,
) {
  if (qty <= EPS) return;
  const cur = map.get(coin);
  const entry =
    cur && cur.side === side && cur.qty > EPS
      ? cur.vwap
      : side === "long"
        ? px - pnl / qty
        : px + pnl / qty;

  pushClosed(closed, {
    coin,
    side,
    qty,
    entryPx: entry,
    exitPx: px,
    realizedPnl: pnl,
    openedAt: cur?.side === side ? cur.openTime : null,
    closedAt: time,
    exitReason: reason,
  });

  if (cur && cur.side === side) {
    cur.qty = Math.max(0, cur.qty - qty);
    if (cur.qty <= EPS) map.delete(coin);
  }
}

export function reconstructClosed(
  fills: Fill[],
  historical: HistoricalOrder[],
  limit = 12,
): ClosedPosition[] {
  const histByOid = new Map<number, HistoricalOrder>();
  for (const item of historical) {
    histByOid.set(item.order.oid, item);
  }

  const sorted = fills.filter(isPerpFill).sort((a, b) => a.time - b.time);
  const inv = new Map<string, Inventory>();
  const closed: ClosedPosition[] = [];

  for (const fill of sorted) {
    const sz = parseNum(fill.sz);
    const px = parseNum(fill.px);
    const pnl = parseNum(fill.closedPnl);
    if (sz <= EPS) continue;
    const reason = detectExitReason(fill, histByOid);
    const start = parseNum(fill.startPosition);

    switch (fill.dir) {
      case "Open Long":
        openInv(inv, fill.coin, "long", sz, px, fill.time);
        break;
      case "Open Short":
        openInv(inv, fill.coin, "short", sz, px, fill.time);
        break;
      case "Close Long":
        closeInv(inv, closed, fill.coin, "long", sz, px, fill.time, pnl, reason);
        break;
      case "Close Short":
        closeInv(inv, closed, fill.coin, "short", sz, px, fill.time, pnl, reason);
        break;
      case "Long > Short": {
        const closedQty = Math.abs(start) > EPS ? Math.abs(start) : sz;
        closeInv(inv, closed, fill.coin, "long", closedQty, px, fill.time, pnl, reason);
        const remainder = sz - closedQty;
        if (remainder > EPS) {
          openInv(inv, fill.coin, "short", remainder, px, fill.time);
        }
        break;
      }
      case "Short > Long": {
        const closedQty = Math.abs(start) > EPS ? Math.abs(start) : sz;
        closeInv(inv, closed, fill.coin, "short", closedQty, px, fill.time, pnl, reason);
        const remainder = sz - closedQty;
        if (remainder > EPS) {
          openInv(inv, fill.coin, "long", remainder, px, fill.time);
        }
        break;
      }
      default:
        break;
    }
  }

  return closed.slice(-limit).reverse();
}

export function computeWinRate(fills: Fill[]): { rate: number | null; sample: number } {
  const closes = fills.filter((fill) => {
    if (!isPerpFill(fill)) return false;
    const dir = fill.dir ?? "";
    if (!(dir.startsWith("Close") || dir.includes(">"))) return false;
    return parseNum(fill.closedPnl) !== 0;
  });
  if (!closes.length) return { rate: null, sample: 0 };
  const wins = closes.filter((fill) => parseNum(fill.closedPnl) > 0).length;
  return { rate: wins / closes.length, sample: closes.length };
}

export function windowPerf(
  row: { windowPerformances: [string, { pnl: string; roi: string; vlm: string }][] },
  window: string,
): { pnl: number; roi: number } {
  const found = row.windowPerformances?.find((item) => item[0] === window)?.[1];
  return {
    pnl: parseNum(found?.pnl),
    roi: parseNum(found?.roi),
  };
}
