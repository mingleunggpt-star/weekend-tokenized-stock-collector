export async function sendTelegram(summary: string, zip: Buffer, runId: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) throw new Error("Telegram env vars are missing");

  const msg = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text: summary, disable_web_page_preview: true })
  });
  if (!msg.ok) throw new Error(`Telegram sendMessage HTTP ${msg.status}: ${await msg.text()}`);

  const form = new FormData();
  form.set("chat_id", chatId);
  form.set("caption", `Weekend tokenized-stock data package — ${runId}`);
  form.set("document", new Blob([zip], { type: "application/zip" }), `weekend_tokenized_stocks_${runId}.zip`);
  const doc = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: form });
  if (!doc.ok) throw new Error(`Telegram sendDocument HTTP ${doc.status}: ${await doc.text()}`);
}
