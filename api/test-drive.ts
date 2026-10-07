import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { Readable } from "node:stream";

function nowHkt() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone:"Asia/Hong_Kong",
      year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", second:"2-digit",
      hour12:false
    }).formatToParts(new Date()).map(p => [p.type,p.value])
  ) as Record<string,string>;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  return {
    timestamp: `${date} ${time}`,
    runId: `${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}HKT`
  };
}

function driveClient() {
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,"\n");
  if(!email) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if(!key) throw new Error("Missing GOOGLE_PRIVATE_KEY");
  const auth = new google.auth.JWT({
    email,
    key,
    scopes:["https://www.googleapis.com/auth/drive"]
  });
  return google.drive({version:"v3",auth});
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  const t=nowHkt();
  try{
    const folder = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if(!folder) throw new Error("Missing GOOGLE_DRIVE_FOLDER_ID");

    const drive = driveClient();
    const name = `Vercel_Drive_Test_${t.runId}.txt`;
    const body = Readable.from([`Google Drive test succeeded at ${t.timestamp} HKT\n`]);

    const made = await drive.files.create({
      requestBody:{name,parents:[folder],mimeType:"text/plain"},
      media:{mimeType:"text/plain",body},
      fields:"id,name"
    });

    return res.status(200).json({
      ok:true,
      test:"google_drive",
      file_id:made.data.id,
      file_name:made.data.name,
      run_id:t.runId
    });
  }catch(e:any){
    console.error(e);
    return res.status(500).json({ok:false,test:"google_drive",error:String(e?.message??e)});
  }
}
