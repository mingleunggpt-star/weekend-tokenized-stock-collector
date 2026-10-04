export const TRACKED = [
  "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA",
  "QQQ", "SPY", "AMD", "AVGO"
] as const;

export type Stock = (typeof TRACKED)[number];

export const OKX_SYMBOL: Record<Stock, string> = Object.fromEntries(
  TRACKED.map((s) => [s, `X${s}-USDT`])
) as Record<Stock, string>;

export const BYBIT_SYMBOL: Record<Stock, string> = Object.fromEntries(
  TRACKED.map((s) => [s, `${s}XUSDT`])
) as Record<Stock, string>;

export const CSV_FIELDS = [
  "timestamp_hkt", "date", "day", "platform", "stock", "token_symbol",
  "friday_close", "token_price", "bid", "ask", "spread_pct", "volume_24h",
  "high_24h", "low_24h", "vs_friday_pct", "run_id", "data_status"
] as const;

export const MASTER_FILE_NAME = "Weekend_Tokenized_Stocks.csv";
