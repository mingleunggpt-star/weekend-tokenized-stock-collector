/**
 * telegram.ts
 *
 * Server-side Telegram sender for Vercel / Node.js.
 *
 * Required environment variables:
 *   TELEGRAM_BOT_TOKEN
 *   TELEGRAM_CHAT_ID
 *
 * Usage:
 *   import { sendTelegramMessage, sendTelegramZip } from "./telegram";
 *
 *   await sendTelegramMessage("Hello");
 *   await sendTelegramZip(zipBuffer, "Weekend_Tokenized_Stocks.zip", "Latest data");
 */

function getTelegramConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN environment variable");
  }

  if (!chatId) {
    throw new Error("Missing TELEGRAM_CHAT_ID environment variable");
  }

  return { token, chatId };
}

async function assertTelegramResponse(
  response: Response,
  action: string
): Promise<void> {
  if (response.ok) return;

  let detail = "";

  try {
    detail = await response.text();
  } catch {
    detail = "Unable to read Telegram error response";
  }

  throw new Error(
    `Telegram ${action} failed (${response.status} ${response.statusText}): ${detail}`
  );
}

/**
 * Send a plain-text Telegram message.
 */
export async function sendTelegramMessage(
  message: string
): Promise<void> {
  const { token, chatId } = getTelegramConfig();

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        disable_web_page_preview: true,
      }),
    }
  );

  await assertTelegramResponse(response, "sendMessage");
}

/**
 * Send a ZIP file to Telegram.
 *
 * Accepts:
 * - Buffer
 * - Uint8Array
 * - ArrayBuffer
 */
export async function sendTelegramZip(
  zipData: Buffer | Uint8Array | ArrayBuffer,
  fileName = "Weekend_Tokenized_Stocks.zip",
  caption?: string
): Promise<void> {
  const { token, chatId } = getTelegramConfig();

  const form = new FormData();
  form.append("chat_id", chatId);

  if (caption) {
    form.append("caption", caption);
  }

  let bytes: Uint8Array;

  if (zipData instanceof ArrayBuffer) {
    bytes = new Uint8Array(zipData);
  } else if (Buffer.isBuffer(zipData)) {
    bytes = new Uint8Array(zipData);
  } else {
    bytes = zipData;
  }

  const blob = new Blob([bytes], {
    type: "application/zip",
  });

  form.append("document", blob, fileName);

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendDocument`,
    {
      method: "POST",
      body: form,
    }
  );

  await assertTelegramResponse(response, "sendDocument");
}

/**
 * Convenience helper:
 * send the summary text first, then optionally send the ZIP.
 */
export async function sendTelegramReport(options: {
  summary: string;
  zipData?: Buffer | Uint8Array | ArrayBuffer;
  zipFileName?: string;
}): Promise<void> {
  const {
    summary,
    zipData,
    zipFileName = "Weekend_Tokenized_Stocks.zip",
  } = options;

  await sendTelegramMessage(summary);

  if (zipData) {
    await sendTelegramZip(
      zipData,
      zipFileName,
      "Weekend Tokenized Stocks data package"
    );
  }
}
