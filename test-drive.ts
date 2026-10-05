import type { VercelRequest, VercelResponse } from "@vercel/node";
import { loadMaster, mergeRows, rowsToCsv, saveMaster } from "../src/drive.js";
import { makeRunId, hktParts } from "../src/time.js";
import type { Observation } from "../src/types.js";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  const runId = makeRunId();
  const now = hktParts();

  try {
    const master = await loadMaster();

    const testRow: Observation = {
      timestamp_hkt: now.timestamp,
      date: now.date,
      day: now.day,
      platform: "SYSTEM_TEST",
      stock: "TEST",
      token_symbol: "TEST",
      friday_close: "",
      token_price: "",
      bid: "",
      ask: "",
      spread_pct: "",
      volume_24h: "",
      high_24h: "",
      low_24h: "",
      vs_friday_pct: "",
      run_id: runId,
      data_status: "DRIVE_WRITE_TEST"
    };

    const merged = mergeRows(master.rows, [testRow]);
    const csv = rowsToCsv(merged);
    const fileId = await saveMaster(master.fileId, csv);

    return res.status(200).json({
      ok: true,
      test: "google_drive",
      run_id: runId,
      timestamp_hkt: now.timestamp,
      google_drive_file_id: fileId,
      rows_before: master.rows.length,
      rows_after: merged.length,
      message: "Google Drive read/write test succeeded."
    });
  } catch (e: any) {
    return res.status(500).json({
      ok: false,
      test: "google_drive",
      error: e?.message ?? String(e)
    });
  }
}
