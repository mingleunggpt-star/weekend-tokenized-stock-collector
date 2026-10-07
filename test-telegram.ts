import type { VercelRequest, VercelResponse } from "@vercel/node";
import JSZip from "jszip";
import { sendTelegram } from "../src/telegram";
import { makeRunId, hktParts } from "../src/time";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const runId = makeRunId();
  const now = hktParts();

  try {
    const summary = [
      "✅ Telegram connection test",
      "",
      `Time: ${now.timestamp} HKT`,
      `Run ID: ${runId}`,
      "",
      "If you received this message and ZIP file, Telegram is configured correctly.",
      "",
      "Raw market data only — no forecast."
    ].join("\n");

    const zip = new JSZip();
    zip.file("telegram_test.txt", summary);
    zip.file("test_metadata.json", JSON.stringify({
      ok: true,
      test: "telegram",
      run_id: runId,
      timestamp_hkt: now.timestamp
    }, null, 2));

    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    await sendTelegram(summary, zipBuffer, runId);

    return res.status(200).json({
      ok: true,
      test: "telegram",
      run_id: runId,
      message_sent: true,
      zip_sent: true
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      test: "telegram",
      error: e?.message ?? String(e)
    });
  }
}
