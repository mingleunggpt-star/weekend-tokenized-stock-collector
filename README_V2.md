# Weekend Tokenized Stock Collector v2

Changes:
- Keeps OKX as the primary weekend tokenized-stock venue.
- Classifies Bybit HTTP 403 as VENUE_ACCESS_BLOCKED_403 instead of a generic fetch error.
- Uses Stooq first for the most recent Friday close, with Twelve Data as fallback.
- Adds friday_close_source to the CSV for auditability.
- Uses MARKET_OK_FRIDAY_CLOSE_MISSING when token market data is valid but the reference close is unavailable.
- Includes status_counts in the run JSON and API response.

Important:
1. Replace only api/collect.ts with the v2 file.
2. Keep CRON_SECRET protection on /api/collect.
3. Delete temporary public endpoints after testing:
   - api/run-once-public.ts
   - api/run-once.ts
   - api/diagnose-drive.ts
   - api/check-data.ts
   - api/oauth-start.ts
   - api/oauth-callback.ts
4. Remove OAUTH_SETUP_SECRET after OAuth setup endpoints are deleted.
5. Keep GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
   GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_OAUTH_REDIRECT_URI,
   GOOGLE_DRIVE_FOLDER_ID, CRON_SECRET, TELEGRAM_BOT_TOKEN,
   TELEGRAM_CHAT_ID, and TWELVE_DATA_API_KEY.

Note:
Kraken xStocks was not added as a weekend fallback because Kraken currently advertises xStocks as 24/5, not weekend CEX trading. A non-equivalent source would make the weekend dataset misleading.
