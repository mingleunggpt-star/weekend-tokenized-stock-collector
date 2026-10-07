import { TRACKED } from "./config";
import { latestFridayDate } from "./time";
import type { Observation } from "./types";

export function reuseFridayClose(rows: Observation[], fridayDate: string) {
  const out: Record<string, number> = {};
  for (const row of rows) {
    if (row.date < fridayDate || !row.friday_close) continue;
    const v = Number(row.friday_close);
    if (Number.isFinite(v)) out[row.stock] = v;
  }
  return out;
}

export async function fetchFridayClose(existing: Record<string, number>) {
  const target = latestFridayDate();
  const missing = TRACKED.filter(s => !Number.isFinite(existing[s]));
  if (!missing.length) return { target, closes: existing };
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return { target, closes: existing };

  const url = new URL("https://api.twelvedata.com/eod");
  url.searchParams.set("symbol", missing.join(","));
  url.searchParams.set("date", target);
  url.searchParams.set("apikey", key);
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`);
  const body: any = await res.json();
  const closes = { ...existing };

  // Batch response is keyed by ticker. Some accounts may return a single object for one symbol.
  for (const stock of missing) {
    const item = body[stock] ?? (body.symbol === stock ? body : undefined);
    const close = Number(item?.close);
    if (Number.isFinite(close)) closes[stock] = close;
  }
  return { target, closes };
}
