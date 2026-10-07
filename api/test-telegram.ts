import type { VercelRequest, VercelResponse } from "@vercel/node";
import JSZip from "jszip";

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

function cfg() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Missing TELEGRAM_CHAT_ID");
  return { token, chatId };
}

async function sendMessage(text:string) {
  const {token,chatId}=cfg();
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
    method:"POST",
    headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text})
  });
  if(!r.ok) throw new Error(`Telegram sendMessage ${r.status}: ${await r.text()}`);
}

async function sendZip(bytes:Uint8Array,name:string) {
  const {token,chatId}=cfg();
  const f=new FormData();
  f.append("chat_id",chatId);
  f.append("caption","Temporary Telegram test");
  f.append("document",new Blob([bytes],{type:"application/zip"}),name);
  const r=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:"POST",body:f});
  if(!r.ok) throw new Error(`Telegram sendDocument ${r.status}: ${await r.text()}`);
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  const t=nowHkt();
  try{
    const text=`✅ Telegram test succeeded\n\nTime: ${t.timestamp} HKT\nRun ID: ${t.runId}\n\nRaw market data only — no forecast.`;
    const zip=new JSZip();
    zip.file("telegram_test.txt",text);
    const bytes=new Uint8Array(await zip.generateAsync({type:"uint8array"}));
    await sendMessage(text);
    await sendZip(bytes,`telegram_test_${t.runId}.zip`);
    return res.status(200).json({ok:true,test:"telegram",message_sent:true,zip_sent:true,run_id:t.runId});
  }catch(e:any){
    console.error(e);
    return res.status(500).json({ok:false,test:"telegram",error:String(e?.message??e)});
  }
}
