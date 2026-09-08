import { describe, it, expect } from "vitest";
import { d, dStr } from "../src/lib/db/money";
import { getEnvRuntimeGate, isSimulatedMode } from "../src/lib/bot/trading-mode";

describe("money Decimal", () => {
  it("évite les artefacts float pour PnL", () => {
    const a = d("0.1").plus(d("0.2"));
    expect(a.toString()).toBe("0.3");
    expect(dStr("100.123456789012345", 8)).toBe("100.12345679");
  });
});

describe("trading mode defaults", () => {
  it("défaut shadow + kill switch on", () => {
    const prev = { ...process.env };
    delete process.env.TRADING_MODE;
    delete process.env.LIVE_TRADING_ENABLED;
    delete process.env.GLOBAL_KILL_SWITCH;
    const g = getEnvRuntimeGate();
    expect(g.tradingMode).toBe("shadow");
    expect(g.liveTradingEnabled).toBe(false);
    expect(g.globalKillSwitch).toBe(true);
    expect(isSimulatedMode(g.tradingMode)).toBe(true);
    process.env = prev;
  });

  it("refuse de considérer live sans flags", () => {
    process.env.TRADING_MODE = "shadow";
    process.env.LIVE_TRADING_ENABLED = "false";
    process.env.GLOBAL_KILL_SWITCH = "true";
    const g = getEnvRuntimeGate();
    expect(g.tradingMode).not.toBe("live");
  });
});
