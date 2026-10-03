import type { VercelRequest, VercelResponse } from "@vercel/node";
import JSZip from "jszip";
import { google } from "googleapis";
import { sendTelegramReport } from "./telegram";

const STOCKS = [
  "NVDA",
  "AAPL",
  "MSFT",
  "AMZN",
  "GOOGL",
  "META",
  "TSLA",
  "QQQ",
  "SPY",
  "AMD",
  "AVGO",
] as const;

type Stock = (typeof STOCKS)[number];

type Row = {
  timestamp_hkt: string;
  date: string;
  day: string;
  platform: string;
  stock: string;
  token_symbol: string;
  friday_close: string;
  token_price: string;
  bid: string;
  ask: string;
  spread_pct: string;
  volume_24h: string;
  high_24h: string;
  low_24h: string;
  vs_friday_pct: string;
  run_id: string;
  data_status: string;
};

const CSV_HEADERS: (keyof Row)[] = [
  "timestamp_hkt",
  "date",
  "day",
  "platform",
  "stock",
  "token_symbol",
  "friday_close",
  "token_price",
  "bid",
  "ask",
  "spread_pct",
  "volume_24h",
  "high_24h",
  "low_24h",
  "vs_friday_pct",
  "run_id",
  "data_status",
];

function hktNow() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Hong_Kong",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map(p => [p.type, p.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}:${parts.second}`,
    day: parts.weekday,
    timestamp: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`,
    runId: `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}HKT`,
  };
}

function csvEscape(value: string) {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function rowsToCsv(rows: Row[]) {
  const lines = [CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(CSV_HEADERS.map(h => csvEscape(row[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

function parseCsv(csv: string): Row[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const headers = lines[0].split(",");
  const out: Row[] = [];

  for (const line of lines.slice(1)) {
    const cells: string[] = [];
    let cur = "";
    let quoted = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (quoted && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          quoted = !quoted;
        }
      } else if (ch === "," && !quoted) {
        cells.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur);

    const obj: any = {};
    headers.forEach((h, i) => (obj[h] = cells[i] ?? ""));
    out.push(obj as Row);
  }
  return out;
}

function dedupe(rows: Row[]) {
  const map = new Map<string, Row>();
  for (const row of rows) {
    const key = `${row.timestamp_hkt}|${row.platform}|${row.token_symbol}`;
    map.set(key, row);
  }
  return [...map.values()];
}

function num(v: unknown) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(a: number, b: number) {
  if (!b) return "";
  return (((a - b) / b) * 100).toFixed(4);
}

function spreadPct(bid: number | null, ask: number | null) {
  if (bid == null || ask == null || bid <= 0 || ask <= 0) return "";
  const mid = (bid + ask) / 2;
  return (((ask - bid) / mid) * 100).toFixed(4);
}

async function fetchFridayClose(stock: Stock): Promise<number | null> {
  const key = process.env.TWELVE_DATA_API_KEY;
  if (!key) return null;

  const url = new URL("https://api.twelvedata.com/time_series");
  url.searchParams.set("symbol", stock);
  url.searchParams.set("interval", "1day");
  url.searchParams.set("outputsize", "7");
  url.searchParams.set("apikey", key);

  const r = await fetch(url);
  if (!r.ok) return null;
  const j: any = await r.json();
  if (!Array.isArray(j.values)) return null;

  // Find the most recent Friday row.
  for (const item of j.values) {
    const d = new Date(`${item.datetime}T12:00:00Z`);
    if (d.getUTCDay() === 5) {
      const close = num(item.close);
      if (close != null) return close;
    }
  }
  return null;
}

async function fetchOkx(stock: Stock) {
  // OKX naming may vary by product; this is the current common form.
  const instId = `X${stock}-USDT`;
  const url = `https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(instId)}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`OKX HTTP ${r.status}`);
  const j: any = await r.json();
  const d = j?.data?.[0];
  if (!d) throw new Error("OKX no data");

  return {
    platform: "OKX",
    token_symbol: instId,
    token_price: num(d.last),
    bid: num(d.bidPx),
    ask: num(d.askPx),
    volume_24h: num(d.volCcy24h ?? d.vol24h),
    high_24h: num(d.high24h),
    low_24h: num(d.low24h),
  };
}

async function fetchBybit(stock: Stock) {
  // Bybit xStocks symbols commonly use e.g. NVDAXUSDT.
  const symbol = `${stock}XUSDT`;
  const url =
    `https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Bybit HTTP ${r.status}`);
  const j: any = await r.json();
  const d = j?.result?.list?.[0];
  if (!d) throw new Error("Bybit no data");

  return {
    platform: "Bybit",
    token_symbol: symbol,
    token_price: num(d.lastPrice),
    bid: num(d.bid1Price),
    ask: num(d.ask1Price),
    volume_24h: num(d.turnover24h ?? d.volume24h),
    high_24h: num(d.highPrice24h),
    low_24h: num(d.lowPrice24h),
  };
}

async function buildRows(): Promise<Row[]> {
  const t = hktNow();
  const rows: Row[] = [];

  for (const stock of STOCKS) {
    const fridayClose = await fetchFridayClose(stock);

    for (const fetcher of [fetchOkx, fetchBybit]) {
      try {
        const m = await fetcher(stock);
        const price = m.token_price;
        rows.push({
          timestamp_hkt: t.timestamp,
          date: t.date,
          day: t.day,
          platform: m.platform,
          stock,
          token_symbol: m.token_symbol,
          friday_close: fridayClose?.toString() ?? "",
          token_price: price?.toString() ?? "",
          bid: m.bid?.toString() ?? "",
          ask: m.ask?.toString() ?? "",
          spread_pct: spreadPct(m.bid, m.ask),
          volume_24h: m.volume_24h?.toString() ?? "",
          high_24h: m.high_24h?.toString() ?? "",
          low_24h: m.low_24h?.toString() ?? "",
          vs_friday_pct:
            fridayClose != null && price != null ? pct(price, fridayClose) : "",
          run_id: t.runId,
          data_status:
            price == null
              ? "PRICE_MISSING"
              : fridayClose == null
              ? "FRIDAY_CLOSE_MISSING"
              : "OK",
        });
      } catch (e: any) {
        rows.push({
          timestamp_hkt: t.timestamp,
          date: t.date,
          day: t.day,
          platform: fetcher === fetchOkx ? "OKX" : "Bybit",
          stock,
          token_symbol:
            fetcher === fetchOkx ? `X${stock}-USDT` : `${stock}XUSDT`,
          friday_close: fridayClose?.toString() ?? "",
          token_price: "",
          bid: "",
          ask: "",
          spread_pct: "",
          volume_24h: "",
          high_24h: "",
          low_24h: "",
          vs_friday_pct: "",
          run_id: t.runId,
          data_status: `FETCH_ERROR:${String(e?.message ?? e)}`.slice(0, 120),
        });
      }
    }
  }

  return rows;
}

function getDrive() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!email || !privateKey) {
    throw new Error("Missing Google service account environment variables");
  }

  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive"],
  });

  return google.drive({ version: "v3", auth });
}

async function upsertMasterCsv(newRows: Row[]) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("Missing GOOGLE_DRIVE_FOLDER_ID");

  const drive = getDrive();
  const fileName = "Weekend_Tokenized_Stocks.csv";

  const found = await drive.files.list({
    q: `'${folderId}' in parents and name='${fileName.replace(/'/g, "\\'")}' and trashed=false`,
    fields: "files(id,name)",
    pageSize: 10,
  });

  const existingFile = found.data.files?.[0];
  let existingRows: Row[] = [];

  if (existingFile?.id) {
    const media = await drive.files.get(
      { fileId: existingFile.id, alt: "media" },
      { responseType: "text" as any }
    );
    existingRows = parseCsv(String(media.data ?? ""));
  }

  const merged = dedupe([...existingRows, ...newRows]);
  const csv = rowsToCsv(merged);

  if (existingFile?.id) {
    await drive.files.update({
      fileId: existingFile.id,
      media: { mimeType: "text/csv", body: csv },
    });
    return { fileId: existingFile.id, csv, totalRows: merged.length };
  }

  const created = await drive.files.create({
    requestBody: {
      name: fileName,
      parents: [folderId],
      mimeType: "text/csv",
    },
    media: { mimeType: "text/csv", body: csv },
    fields: "id",
  });

  return { fileId: created.data.id ?? "", csv, totalRows: merged.length };
}

function buildTelegramSummary(rows: Row[]) {
  const t = hktNow();
  const byStock = new Map<string, Row[]>();

  for (const row of rows) {
    const list = byStock.get(row.stock) ?? [];
    list.push(row);
    byStock.set(row.stock, list);
  }

  const lines = [
    `Weekend Tokenized Stocks — ${t.timestamp} HKT`,
    "",
  ];

  for (const stock of STOCKS) {
    const list = byStock.get(stock) ?? [];
    const ok = list.find(x => x.data_status === "OK") ?? list[0];
    if (!ok) {
      lines.push(`${stock} — NO_DATA`);
      continue;
    }

    const price = ok.token_price || "-";
    const vsFri = ok.vs_friday_pct ? `${ok.vs_friday_pct}%` : "-";
    const volume = ok.volume_24h || "-";
    const spread = ok.spread_pct ? `${ok.spread_pct}%` : "-";
    lines.push(
      `${stock} | ${ok.platform} | px ${price} | vs Fri ${vsFri} | vol ${volume} | spread ${spread} | ${ok.data_status}`
    );
  }

  lines.push("", "Raw market data only — no forecast.");
  return lines.join("\n");
}

async function buildZip(latestCsv: string, masterCsv: string, summary: string, runId: string) {
  const zip = new JSZip();
  zip.file(`latest_run_${runId}.csv`, latestCsv);
  zip.file("Weekend_Tokenized_Stocks_master.csv", masterCsv);
  zip.file(`telegram_summary_${runId}.txt`, summary);
  zip.file(
    `run_${runId}.json`,
    JSON.stringify(
      {
        run_id: runId,
        generated_at_hkt: hktNow().timestamp,
        stocks: STOCKS,
        note: "Raw market data only — no forecast.",
      },
      null,
      2
    )
  );

  return new Uint8Array(
    await zip.generateAsync({
      type: "uint8array",
      compression: "DEFLATE",
      compressionOptions: { level: 6 },
    })
  );
}

function authorized(req: VercelRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // useful during initial setup; set CRON_SECRET in production.
  const auth = req.headers.authorization;
  return auth === `Bearer ${secret}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!authorized(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const run = hktNow();

  try {
    const newRows = await buildRows();
    const latestCsv = rowsToCsv(newRows);

    // Drive update happens before Telegram so the master remains the source of truth.
    const driveResult = await upsertMasterCsv(newRows);

    const summary = buildTelegramSummary(newRows);
    const zipData = await buildZip(
      latestCsv,
      driveResult.csv,
      summary,
      run.runId
    );

    await sendTelegramReport({
      summary,
      zipData,
      zipFileName: `Weekend_Tokenized_Stocks_${run.runId}.zip`,
    });

    return res.status(200).json({
      ok: true,
      run_id: run.runId,
      rows_collected: newRows.length,
      master_rows: driveResult.totalRows,
      drive_file_id: driveResult.fileId,
      telegram_sent: true,
    });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({
      ok: false,
      run_id: run.runId,
      error: String(e?.message ?? e),
    });
  }
}
