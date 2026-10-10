import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";

function driveClient() {
  const { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET,
          GOOGLE_OAUTH_REFRESH_TOKEN, GOOGLE_OAUTH_REDIRECT_URI } = process.env;
  if (!GOOGLE_OAUTH_CLIENT_ID || !GOOGLE_OAUTH_CLIENT_SECRET ||
      !GOOGLE_OAUTH_REFRESH_TOKEN || !GOOGLE_OAUTH_REDIRECT_URI) {
    throw new Error("Missing Google OAuth env vars");
  }
  const auth = new google.auth.OAuth2(
    GOOGLE_OAUTH_CLIENT_ID,
    GOOGLE_OAUTH_CLIENT_SECRET,
    GOOGLE_OAUTH_REDIRECT_URI
  );
  auth.setCredentials({ refresh_token: GOOGLE_OAUTH_REFRESH_TOKEN });
  return google.drive({ version: "v3", auth });
}

function parseCsv(csv:string): string[][] {
  const rows:string[][] = [];
  let row:string[] = [], cell = "", q = false;
  for (let i=0;i<csv.length;i++) {
    const c=csv[i];
    if (q) {
      if (c === '"' && csv[i+1] === '"') { cell += '"'; i++; }
      else if (c === '"') q=false;
      else cell += c;
    } else {
      if (c === '"') q=true;
      else if (c === ',') { row.push(cell); cell=""; }
      else if (c === '\n') { row.push(cell.replace(/\r$/,"")); rows.push(row); row=[]; cell=""; }
      else cell += c;
    }
  }
  if (cell.length || row.length) { row.push(cell.replace(/\r$/,"")); rows.push(row); }
  return rows.filter(r => r.some(x => x !== ""));
}

export default async function handler(req:VercelRequest,res:VercelResponse) {
  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) throw new Error("Missing GOOGLE_DRIVE_FOLDER_ID");
    const drive = driveClient();

    const q = `'${folderId}' in parents and name = 'Weekend_Tokenized_Stocks.csv' and trashed = false`;
    const list = await drive.files.list({
      q, spaces:"drive", fields:"files(id,name,modifiedTime,size)", orderBy:"modifiedTime desc", pageSize:10
    });
    const file = list.data.files?.[0];
    if (!file?.id) throw new Error("Weekend_Tokenized_Stocks.csv not found");

    const dl = await drive.files.get({ fileId:file.id, alt:"media" }, { responseType:"text" });
    const csv = String(dl.data ?? "");
    const rows = parseCsv(csv);
    if (rows.length < 2) throw new Error("CSV has no data rows");
    const header = rows[0];
    const idx = Object.fromEntries(header.map((h,i)=>[h,i]));
    const data = rows.slice(1);

    const wanted = ["timestamp_hkt","platform","stock","token_symbol","friday_close","token_price","bid","ask","spread_pct","volume_24h","high_24h","low_24h","vs_friday_pct","data_status"];
    const mapped = data.map(r => Object.fromEntries(wanted.map(k => [k, r[idx[k]] ?? ""])));

    const byStatus:Record<string,number> = {};
    const byPlatform:Record<string,{rows:number,ok:number,error:number}> = {};
    for (const r of mapped) {
      const s = String(r.data_status || "BLANK");
      byStatus[s] = (byStatus[s] || 0) + 1;
      const p = String(r.platform || "UNKNOWN");
      byPlatform[p] ||= {rows:0,ok:0,error:0};
      byPlatform[p].rows++;
      if (/^OK$/i.test(s)) byPlatform[p].ok++; else byPlatform[p].error++;
    }

    const suspicious = mapped.filter(r =>
      !/^OK$/i.test(String(r.data_status)) ||
      !String(r.token_price) ||
      !String(r.bid) ||
      !String(r.ask)
    );

    return res.status(200).json({
      ok:true,
      file:{id:file.id,name:file.name,modifiedTime:file.modifiedTime,size:file.size},
      total_rows:mapped.length,
      status_counts:byStatus,
      platform_summary:byPlatform,
      suspicious_rows:suspicious,
      all_rows:mapped
    });
  } catch(e:any) {
    return res.status(500).json({ok:false,error:String(e?.message ?? e)});
  }
}
