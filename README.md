# Weekend Tokenized Stock Collector

Vercel serverless collector for weekend tokenized-stock raw market data.

## What it does

Tracks:

- NVDA
- AAPL
- MSFT
- AMZN
- GOOGL
- META
- TSLA
- QQQ
- SPY
- AMD
- AVGO

Sources:

- OKX tokenized-stock market API
- Bybit xStocks market API
- Twelve Data for official Friday close

Each run:

1. Fetches current tokenized-stock prices and market fields.
2. Fetches the latest Friday official close.
3. Appends to one master CSV in Google Drive.
4. De-duplicates by `timestamp_hkt + platform + token_symbol`.
5. Builds a ZIP package with the latest run, master CSV, summary, and metadata.
6. Sends a Telegram message and ZIP file.
7. Does not forecast, score, or output BULL/BEAR signals.

## Files

```text
api/
  collect.ts
  telegram.ts
package.json
tsconfig.json
vercel.json
.env.example
.gitignore
README.md
```

## Vercel environment variables

Set these in:

Vercel Project → Settings → Environment Variables

```text
CRON_SECRET
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
GOOGLE_SERVICE_ACCOUNT_EMAIL
GOOGLE_PRIVATE_KEY
GOOGLE_DRIVE_FOLDER_ID
TWELVE_DATA_API_KEY
```

Do not commit real secrets to GitHub.

## Google Drive setup

Create or use a folder such as:

```text
TradingBot
```

Share that folder with the Google service-account email as Editor.

Put the folder ID into:

```text
GOOGLE_DRIVE_FOLDER_ID
```

The program maintains one file:

```text
Weekend_Tokenized_Stocks.csv
```

## Telegram setup

Create a bot with BotFather.

Use a newly generated bot token, especially if an older token was ever pasted into a chat or repository.

Set:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID
```

## Vercel Cron schedule

Vercel cron uses UTC.

Current `vercel.json`:

```text
Friday 22:15 UTC  = Saturday 06:15 Hong Kong time
Saturday 12:00 UTC = Saturday 20:00 Hong Kong time
Sunday 12:00 UTC = Sunday 20:00 Hong Kong time
```

The first run occurs after the US Friday session has closed.

## Manual test

Once deployed, visit:

```text
https://YOUR-PROJECT.vercel.app/api/collect
```

If `CRON_SECRET` is set, send:

```text
Authorization: Bearer YOUR_CRON_SECRET
```

Vercel Cron automatically sends the configured cron secret when supported/configured for the project.

## CSV columns

```text
timestamp_hkt
date
day
platform
stock
token_symbol
friday_close
token_price
bid
ask
spread_pct
volume_24h
high_24h
low_24h
vs_friday_pct
run_id
data_status
```

## Important

Tokenized-stock symbols and exchange product availability can change. If OKX or Bybit changes naming conventions, edit the symbol construction inside:

```text
api/collect.ts
```

The system marks fetch failures in `data_status` rather than inventing data.

Raw market data only — no forecast.
