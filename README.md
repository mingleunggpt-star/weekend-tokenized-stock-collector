# Weekend Tokenized Stock Collector — Google Drive OAuth edition

This edition uses the user's own Google Drive account through OAuth, avoiding the
"Service Accounts do not have storage quota" error.

## Required Vercel variables

- `CRON_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_CHAT_ID`
- `GOOGLE_DRIVE_FOLDER_ID`
- `TWELVE_DATA_API_KEY`
- `GOOGLE_OAUTH_CLIENT_ID`
- `GOOGLE_OAUTH_CLIENT_SECRET`
- `GOOGLE_OAUTH_REFRESH_TOKEN`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `OAUTH_SETUP_SECRET` (temporary; remove after setup)

The old `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` are not used by this edition.

## One-time OAuth setup

1. In Google Cloud Console, enable Google Drive API.
2. Configure the OAuth consent screen. Add your own Google account as a test user if the app is in Testing.
3. Create an OAuth Client ID of type **Web application**.
4. Add this Authorized redirect URI exactly:
   `https://weekend-tokenized-stock-collector.vercel.app/api/oauth-callback`
5. Put the Client ID and Client Secret in Vercel.
6. Set `GOOGLE_OAUTH_REDIRECT_URI` to the URI above.
7. Set `OAUTH_SETUP_SECRET` to a random temporary secret.
8. Redeploy Production.
9. Open:
   `https://weekend-tokenized-stock-collector.vercel.app/api/oauth-start?secret=YOUR_SETUP_SECRET`
10. Approve Google Drive access. The callback page displays a refresh token.
11. Put that token in Vercel as `GOOGLE_OAUTH_REFRESH_TOKEN`, redeploy, then test:
    `https://weekend-tokenized-stock-collector.vercel.app/api/test-drive`
12. After success, delete `api/oauth-start.ts` and `api/oauth-callback.ts`, and remove `OAUTH_SETUP_SECRET`.

For long-running unattended automation, avoid leaving the OAuth consent app in a mode
where refresh tokens expire quickly. Review your Google OAuth publishing status and policies.
