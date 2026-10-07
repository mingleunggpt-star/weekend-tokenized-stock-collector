import type { VercelRequest, VercelResponse } from "@vercel/node";
import { fetchOkx, fetchBybit } from "../src/market";
import { loadMaster, mergeRows, rowsToCsv, saveMaster } from "../src/drive";
import { reuseFridayClose, fetchFridayClose } from "../src/fridayClose";
import { latestFridayDate, hktParts, makeRunId } from "../src/time";
import { makeSummary, buildZip } from "../src/packageRun";
import { sendTelegram } from "../src/telegram";
import type { Observation } from "../src/types";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ ok: false, error: "Unauthorized" });

  const slot = String(req.query.slot ?? "manual");
  const runId = makeRunId();
  const now = hktParts();
  let masterFileId: string | undefined;
  let oldRows: Observation[] = [];

  try {
    const master = await loadMaster();
    masterFileId = master.fileId;
    oldRows = master.rows;
  } catch (e: any) {
    return res.status(500).json({ ok: false, stage: "drive_read", error: e.message, master_preserved: true });
  }

  let closes: Record<string, number> = {};
  try {
    closes = reuseFridayClose(oldRows, latestFridayDate());
    closes = (await fetchFridayClose(closes)).closes;
  } catch (e: any) {
    // Continue raw token collection, but Friday-close-dependent fields remain blank where unavailable.
  }

  const rows: Observation[] = [];
  const errors: string[] = [];
  const results = await Promise.allSettled([fetchOkx(closes), fetchBybit(closes)]);
  for (const r of results) {
    if (r.status === "fulfilled") rows.push(...r.value);
    else errors.push(r.reason?.message ?? String(r.reason));
  }
  if (!rows.length) {
    return res.status(502).json({ ok: false, stage: "market_fetch", errors, master_preserved: true });
  }

  // Add a status suffix when Friday close was unavailable, without fabricating values.
  for (const r of rows) {
    if (!r.friday_close) r.data_status = r.data_status === "OK" ? "OK_NO_FRIDAY_CLOSE" : `${r.data_status}_NO_FRIDAY_CLOSE`;
  }

  const merged = mergeRows(oldRows, rows);
  const masterCsv = rowsToCsv(merged);
  try {
    masterFileId = await saveMaster(masterFileId, masterCsv);
  } catch (e: any) {
    return res.status(500).json({ ok: false, stage: "drive_write", error: e.message, market_rows: rows.length, master_preserved: true });
  }

  const summary = makeSummary(rows, now.timestamp);
  let telegram = "sent";
  try {
    const zip = await buildZip(rows, masterCsv, summary, runId);
    await sendTelegram(summary, zip, runId);
  } catch (e: any) {
    telegram = `failed: ${e.message}`;
  }

  return res.status(200).json({
    ok: true,
    slot,
    run_id: runId,
    timestamp_hkt: now.timestamp,
    friday_reference_date: latestFridayDate(),
    new_rows: rows.length,
    total_rows: merged.length,
    market_fetch_warnings: errors,
    google_drive_file_id: masterFileId,
    telegram
  });
}
