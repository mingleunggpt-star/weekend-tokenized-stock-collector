import JSZip from "jszip";
import { stringify } from "csv-stringify/sync";
import { CSV_FIELDS } from "./config.js";
import type { Observation } from "./types.js";

export function makeSummary(rows: Observation[], timestamp: string) {
  const lines = [`Weekend Tokenized Stocks — ${timestamp} HKT`, ""];
  for (const stock of [...new Set(rows.map(r => r.stock))]) {
    const items = rows.filter(r => r.stock === stock);
    for (const r of items) {
      lines.push(`${stock} ${r.platform}: ${r.token_price || "N/A"} | vs Fri ${r.vs_friday_pct ? r.vs_friday_pct + "%" : "N/A"} | 24h vol ${r.volume_24h || "N/A"} | spread ${r.spread_pct ? r.spread_pct + "%" : "N/A"} | ${r.data_status}`);
    }
  }
  lines.push("", "Raw market data only — no forecast.");
  return lines.join("\n");
}

export async function buildZip(runRows: Observation[], masterCsv: string, summary: string, runId: string) {
  const zip = new JSZip();
  zip.file(`latest_run_${runId}.csv`, stringify(runRows, { header: true, columns: [...CSV_FIELDS], bom: true }));
  zip.file("Weekend_Tokenized_Stocks_master.csv", masterCsv);
  zip.file(`summary_${runId}.txt`, summary);
  zip.file(`metadata_${runId}.json`, JSON.stringify({ run_id: runId, rows: runRows.length, generated_hkt: runRows[0]?.timestamp_hkt ?? "" }, null, 2));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
}
