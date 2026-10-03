/**
 * api/telegram.ts
 *
 * Server-side Telegram sender for Vercel / Node.js.
 * Required environment variables:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 */

function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Missing TELEGRAM_CHAT_ID");

  return { token, chatId };
}

async function assertOk(response: Response, action: string) {
  if (response.ok) return;
  const detail = await response.text().catch(() => "");
  throw new Error(
    `Telegram ${action} failed (${response.status} ${response.statusText}): ${detail}`
  );
}

export async function sendTelegramMessage(message: string): Promise<void> {
  const { token, chatId } = getTelegramConfig();

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    }
  );

  await assertOk(response, "sendMessage");
}

export async function sendTelegramDocument(
  data: Uint8Array,
  fileName: string,
  mimeType = "application/octet-stream",
  caption?: string
): Promise<void> {
  const { token, chatId } = getTelegramConfig();

  const form = new FormData();
  form.append("chat_id", chatId);
  if (caption) form.append("caption", caption);

  const blob = new Blob([data], { type: mimeType });
  form.append("document", blob, fileName);

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendDocument`,
    {
      method: "POST",
      body: form,
    }
  );

  await assertOk(response, "sendDocument");
}

export async function sendTelegramReport(options: {
  summary: string;
  zipData?: Uint8Array;
  zipFileName?: string;
}): Promise<void> {
  await sendTelegramMessage(options.summary);

  if (options.zipData) {
    await sendTelegramDocument(
      options.zipData,
      options.zipFileName ?? "Weekend_Tokenized_Stocks.zip",
      "application/zip",
      "Weekend Tokenized Stocks data package"
    );
  }
}
