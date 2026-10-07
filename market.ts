import { TRACKED, OKX_SYMBOL, BYBIT_SYMBOL, type Stock } from "./config";
import type { Observation } from "./types";
import { hktParts, makeRunId } from "./time";

const n = (v: unknown) => {
  const x = Number(v);
  return Number.isFinite(x) ? x : NaN;
};
const s = (v: number) => Number.isFinite(v) ? String(v) : "";
const pct = (price: number, base?: number) =>
  base && Number.isFinite(price) ? (((price - base) / base) * 100).toFixed(4) : "";
const spread = (bid: number, ask: number) => {
  const mid = (bid + ask) / 2;
  return mid > 0 ? (((ask - bid) / mid) * 100).toFixed(4) : "";
};

export async function fetchOkx(friday: Record<string, number>): Promise<Observation[]> {
  const res = await fetch("https://www.okx.com/api/v5/market/tickers?instType=SPOT", { cache: "no-store" });
  if (!res.ok) throw new Error(`OKX HTTP ${res.status}`);
  const body: any = await res.json();
  const map = new Map((body.data ?? []).map((x: any) => [x.instId, x]));
  const now = hktParts();
  const runId = makeRunId();
  return TRACKED.map((stock) => {
    const inst = OKX_SYMBOL[stock];
    const x: any = map.get(inst);
    if (!x) return blank(now, runId, "OKX", stock, inst, friday[stock], "PAIR_UNAVAILABLE");
    const price = n(x.last), bid = n(x.bidPx), ask = n(x.askPx);
    const status = Number.isFinite(price) ? "OK" : "PRICE_UNAVAILABLE";
    return {
      timestamp_hkt: now.timestamp, date: now.date, day: now.day,
      platform: "OKX", stock, token_symbol: inst,
      friday_close: s(friday[stock]), token_price: s(price), bid: s(bid), ask: s(ask),
      spread_pct: spread(bid, ask),
      // Quote-currency 24h volume (USDT) for cross-venue comparability.
      volume_24h: String(x.volCcy24h ?? ""),
      high_24h: String(x.high24h ?? ""), low_24h: String(x.low24h ?? ""),
      vs_friday_pct: pct(price, friday[stock]), run_id: runId, data_status: status
    };
  });
}

export async function fetchBybit(friday: Record<string, number>): Promise<Observation[]> {
  const [instRes, tickRes] = await Promise.all([
    fetch("https://api.bybit.com/v5/market/instruments-info?category=spot&symbolType=xstocks&limit=1000", { cache: "no-store" }),
    fetch("https://api.bybit.com/v5/market/tickers?category=spot", { cache: "no-store" })
  ]);
  if (!instRes.ok) throw new Error(`Bybit instruments HTTP ${instRes.status}`);
  if (!tickRes.ok) throw new Error(`Bybit tickers HTTP ${tickRes.status}`);
  const instruments: any = await instRes.json();
  const tickers: any = await tickRes.json();
  const instMap = new Map((instruments.result?.list ?? []).map((x: any) => [x.symbol, x]));
  const tickMap = new Map((tickers.result?.list ?? []).map((x: any) => [x.symbol, x]));
  const now = hktParts();
  const runId = makeRunId();

  return TRACKED.map((stock) => {
    const symbol = BYBIT_SYMBOL[stock];
    const meta: any = instMap.get(symbol);
    const x: any = tickMap.get(symbol);
    if (!meta || !x) return blank(now, runId, "BYBIT", stock, symbol, friday[stock], "PAIR_UNAVAILABLE");
    const mult = n(meta.xstockMultiplier || "1") || 1;
    const price = n(x.lastPrice) / mult;
    const bid = n(x.bid1Price) / mult;
    const ask = n(x.ask1Price) / mult;
    const high = n(x.highPrice24h) / mult;
    const low = n(x.lowPrice24h) / mult;
    return {
      timestamp_hkt: now.timestamp, date: now.date, day: now.day,
      platform: "BYBIT", stock, token_symbol: symbol,
      friday_close: s(friday[stock]), token_price: s(price), bid: s(bid), ask: s(ask),
      spread_pct: spread(bid, ask), volume_24h: String(x.turnover24h ?? ""),
      high_24h: s(high), low_24h: s(low), vs_friday_pct: pct(price, friday[stock]),
      run_id: runId, data_status: "OK"
    };
  });
}

function blank(now: ReturnType<typeof hktParts>, runId: string, platform: string, stock: Stock, symbol: string, fridayClose: number | undefined, status: string): Observation {
  return {
    timestamp_hkt: now.timestamp, date: now.date, day: now.day, platform, stock,
    token_symbol: symbol, friday_close: s(fridayClose), token_price: "", bid: "", ask: "",
    spread_pct: "", volume_24h: "", high_24h: "", low_24h: "", vs_friday_pct: "",
    run_id: runId, data_status: status
  };
}
