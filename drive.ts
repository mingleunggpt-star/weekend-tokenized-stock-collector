import { google } from "googleapis";
import { Readable } from "node:stream";
import { parse } from "csv-parse/sync";
import { stringify } from "csv-stringify/sync";
import { CSV_FIELDS, MASTER_FILE_NAME } from "./config.js";
import type { Observation } from "./types.js";

function driveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!email || !privateKey) throw new Error("Google service-account env vars are missing");
  const auth = new google.auth.JWT({
    email,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/drive.file", "https://www.googleapis.com/auth/drive"]
  });
  return google.drive({ version: "v3", auth });
}

export async function loadMaster(): Promise<{ fileId?: string; rows: Observation[] }> {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("GOOGLE_DRIVE_FOLDER_ID is missing");
  const drive = driveClient();
  const q = `'${folderId}' in parents and name='${MASTER_FILE_NAME.replace(/'/g, "\\'")}' and trashed=false`;
  const list = await drive.files.list({ q, fields: "files(id,name)", pageSize: 10 });
  const file = list.data.files?.[0];
  if (!file?.id) return { rows: [] };
  const data = await drive.files.get({ fileId: file.id, alt: "media" }, { responseType: "text" as any });
  const text = String(data.data ?? "");
  const rows = text.trim() ? parse(text, { columns: true, skip_empty_lines: true, bom: true }) as Observation[] : [];
  return { fileId: file.id, rows };
}

export function mergeRows(oldRows: Observation[], newRows: Observation[]) {
  const map = new Map<string, Observation>();
  for (const row of [...oldRows, ...newRows]) {
    map.set(`${row.timestamp_hkt}|${row.platform}|${row.token_symbol}`, row);
  }
  return [...map.values()].sort((a, b) => a.timestamp_hkt.localeCompare(b.timestamp_hkt));
}

export function rowsToCsv(rows: Observation[]) {
  return stringify(rows, { header: true, columns: [...CSV_FIELDS], bom: true });
}

export async function saveMaster(fileId: string | undefined, csv: string) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error("GOOGLE_DRIVE_FOLDER_ID is missing");
  const drive = driveClient();
  const media = { mimeType: "text/csv", body: Readable.from([csv]) };
  if (fileId) {
    await drive.files.update({ fileId, media });
    return fileId;
  }
  const created = await drive.files.create({
    requestBody: { name: MASTER_FILE_NAME, parents: [folderId], mimeType: "text/csv" },
    media,
    fields: "id"
  });
  if (!created.data.id) throw new Error("Google Drive did not return a file ID");
  return created.data.id;
}
