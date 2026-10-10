# Weekend Tokenized Stock Collector v2.1

Friday-close strategy
1. Yahoo Finance chart endpoint (unofficial) for the most recent Friday daily close.
2. Twelve Data time_series as fallback.
3. If both fail: MARKET_OK_FRIDAY_CLOSE_MISSING.

Other behavior retained from v2
- OKX weekend tokenized-stock snapshot remains primary.
- Bybit HTTP 403 is classified as VENUE_ACCESS_BLOCKED_403.
- CSV keeps friday_close_source for provenance.
- Telegram sends raw-data summary + ZIP.
- Google Drive master CSV is append-preserving and deduplicated.
- No forecast / no trading signal.

Expected validation target
- rows_collected: 22
- ideally OK: 11
- VENUE_ACCESS_BLOCKED_403: 11
- MARKET_OK_FRIDAY_CLOSE_MISSING: 0

Notes
- Yahoo Finance chart is unofficial and can rate-limit or change without notice.
- Keep Twelve Data as the authenticated fallback.
- After testing, delete any temporary test endpoint and keep only api/collect.ts for cron execution.
