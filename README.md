# Weekend Tokenized Stock Collector (Vercel)

Collects raw weekend tokenized-stock market data only. It does **not** forecast, score, or emit BULL/BEAR signals.

## What it does

1. Pulls tokenized-stock quotes from OKX Unified Tokenized Stocks and Bybit xStocks.
2. Pulls the official Friday EOD close for the underlying U.S. stock/ETF from Twelve Data.
3. Appends observations to one Google Drive master CSV: `Weekend_Tokenized_Stocks.csv`.
4. De-duplicates by `timestamp_hkt + platform + token_symbol`.
5. Builds a ZIP containing:
   - latest run CSV
   - full master CSV snapshot
   - Telegram-ready summary TXT
   - run metadata JSON
6. Sends the summary and ZIP to your Telegram chat.

Tracked initially: NVDA, AAPL, MSFT, AMZN, GOOGL, META, TSLA, QQQ, SPY, AMD, AVGO.

`volume_24h` is stored as quote-currency turnover/volume in USDT where the venue exposes it, so cross-venue numbers are more comparable.

## Schedule

Vercel Cron uses UTC.

- Friday 22:15 UTC = Saturday 06:15 HKT: after the U.S. Friday close, captures the Friday-close baseline and token quotes.
- Saturday 12:00 UTC = Saturday 20:00 HKT: weekend snapshot.
- Sunday 12:00 UTC = Sunday 20:00 HKT: weekend snapshot.

## 1. Telegram setup

The bot token posted in chat should be revoked. Create a fresh token in @BotFather and store it only in Vercel Environment Variables.

To get `TELEGRAM_CHAT_ID`:

1. Send any message to your bot in Telegram.
2. Temporarily open this URL locally in your browser, replacing `<NEW_TOKEN>`:
   `https://api.telegram.org/bot<NEW_TOKEN>/getUpdates`
3. Find `message.chat.id` and copy the integer value.
4. Do not commit the token or chat ID to GitHub.

## 2. Google Drive setup

1. In Google Cloud Console, create a project and enable **Google Drive API**.
2. Create a **service account** and a JSON key.
3. In your own Google Drive, create a folder named `TradingBot`.
4. Share that folder with the service-account email as **Editor**.
5. Open the folder in the browser. The part after `/folders/` is `GOOGLE_DRIVE_FOLDER_ID`.
6. Put `client_email` into `GOOGLE_SERVICE_ACCOUNT_EMAIL`.
7. Put the JSON key's `private_key` into `GOOGLE_PRIVATE_KEY`. In Vercel it can be pasted with its line breaks; this project also accepts `\n` escaped newlines.

The project creates/updates `Weekend_Tokenized_Stocks.csv` inside that shared folder.

## 3. Twelve Data setup

Create a Twelve Data API key and store it as `TWELVE_DATA_API_KEY`. The collector uses the EOD endpoint to retrieve the official Friday close. If the key or a close is unavailable, token prices are still collected and `data_status` is marked accordingly; no close is invented.

## 4. Vercel Environment Variables

Set these for Production (and Preview if desired):

- `CRON_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GOOGLE_SERVICE_ACCOUNT_EMAIL`
- `GOOGLE_PRIVATE_KEY`
- `GOOGLE_DRIVE_FOLDER_ID`
- `TWELVE_DATA_API_KEY`

Generate `CRON_SECRET` locally, for example:

```bash
openssl rand -hex 32
```

## 5. Deploy

Push this folder to GitHub, import the repo into Vercel, add all environment variables, then deploy. Vercel reads the three cron entries from `vercel.json` automatically.

## 6. Manual test

After deployment:

```bash
curl -H "Authorization: Bearer YOUR_CRON_SECRET" \
  "https://YOUR_PROJECT.vercel.app/api/collect?slot=manual-test"
```

Expected JSON includes `ok: true`, `new_rows`, `total_rows`, a Google Drive file ID, and Telegram send status.

## Failure behavior

- If Google Drive cannot be read: the run stops before market data is written.
- If both market sources fail: the run stops and the previous master CSV is preserved.
- If one venue fails: the successful venue is saved and the warning is returned.
- If Google Drive write fails: Telegram packaging/sending is skipped so the Drive master remains authoritative.
- If Telegram fails: Drive data remains saved; the API response reports the Telegram error.
- Missing fields remain blank. The program never invents market values.

## Security

Never put secrets in `vercel.json`, source files, GitHub, the CSV, or Telegram messages. Keep them in Vercel Environment Variables. Revoke any token that has been exposed in chat or source control.
