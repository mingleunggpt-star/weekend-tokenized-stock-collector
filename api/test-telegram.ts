import type { VercelRequest, VercelResponse } from "@vercel/node";
import JSZip from "jszip";
import { google } from "googleapis";
import { Readable } from "node:stream";

const STOCKS = ["NVDA","AAPL","MSFT","AMZN","GOOGL","META","TSLA","QQQ","SPY","AMD","AVGO"] as const;
type Stock = (typeof STOCKS)[number];

type Row = {
  timestamp_hkt: string; date: string; day: string; platform: string; stock: string;
  token_symbol: string; friday_close: string; token_price: string; bid: string; ask: string;
  spread_pct: string; volume_24h: string; high_24h: string; low_24h: string;
  vs_friday_pct: string; run_id: string; data_status: string;
};

const HEADERS: (keyof Row)[] = ["timestamp_hkt","date","day","platform","stock","token_symbol","friday_close","token_price","bid","ask","spread_pct","volume_24h","high_24h","low_24h","vs_friday_pct","run_id","data_status"];

function nowHkt() {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone:"Asia/Hong_Kong", year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", second:"2-digit", weekday:"short", hour12:false
    }).formatToParts(new Date()).map(p => [p.type,p.value])
  ) as Record<string,string>;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${parts.hour}:${parts.minute}:${parts.second}`;
  return {date, day:parts.weekday, timestamp:`${date} ${time}`, runId:`${parts.year}${parts.month}${parts.day}T${parts.hour}${parts.minute}${parts.second}HKT`};
}

function authOk(req: VercelRequest) {
  const s = process.env.CRON_SECRET;
  return !!s && req.headers.authorization === `Bearer ${s}`;
}

function esc(v:string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g,'""')}"` : v; }
function rowsToCsv(rows:Row[]) {
  return [HEADERS.join(","), ...rows.map(r => HEADERS.map(h => esc(r[h] ?? "")).join(","))].join("\n") + "\n";
}

function parseCsv(csv:string):Row[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length <= 1) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).filter(Boolean).map(line => {
    const cells:string[]=[]; let cur=""; let q=false;
    for (let i=0;i<line.length;i++) {
      const c=line[i];
      if (c === '"') {
        if (q && line[i+1] === '"') { cur += '"'; i++; } else q = !q;
      } else if (c === "," && !q) { cells.push(cur); cur=""; } else cur += c;
    }
    cells.push(cur);
    const o:any={}; headers.forEach((h,i)=>o[h]=cells[i] ?? "");
    return o as Row;
  });
}

function dedupe(rows:Row[]) {
  const m = new Map<string,Row>();
  for (const r of rows) m.set(`${r.timestamp_hkt}|${r.platform}|${r.token_symbol}`,r);
  return [...m.values()];
}

function n(v:any):number|null { const x=Number(v); return Number.isFinite(x)?x:null; }
function spread(b:number|null,a:number|null) {
  if (b==null||a==null||b<=0||a<=0) return "";
  return (((a-b)/((a+b)/2))*100).toFixed(4);
}
function vsFriday(p:number|null,c:number|null) {
  if (p==null||c==null||c===0) return "";
  return (((p-c)/c)*100).toFixed(4);
}

function telegramConfig() {
  const token=process.env.TELEGRAM_BOT_TOKEN;
  const chatId=process.env.TELEGRAM_CHAT_ID;
  if (!token) throw new Error("Missing TELEGRAM_BOT_TOKEN");
  if (!chatId) throw new Error("Missing TELEGRAM_CHAT_ID");
  return {token,chatId};
}

async function tgMessage(text:string) {
  const {token,chatId}=telegramConfig();
  const r=await fetch(`https://api.telegram.org/bot${token}/sendMessage`,{
    method:"POST", headers:{"content-type":"application/json"},
    body:JSON.stringify({chat_id:chatId,text,disable_web_page_preview:true})
  });
  if(!r.ok) throw new Error(`Telegram sendMessage ${r.status}: ${await r.text()}`);
}

async function tgZip(bytes:Uint8Array,name:string,caption:string) {
  const {token,chatId}=telegramConfig();
  const f=new FormData();
  f.append("chat_id",chatId);
  f.append("caption",caption);
  const ab = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  f.append("document",new Blob([ab],{type:"application/zip"}),name);
  const r=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:"POST",body:f});
  if(!r.ok) throw new Error(`Telegram sendDocument ${r.status}: ${await r.text()}`);
}

function driveClient() {
  const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const key=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,"\n");
  if(!email) throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_EMAIL");
  if(!key) throw new Error("Missing GOOGLE_PRIVATE_KEY");
  const auth=new google.auth.JWT({email,key,scopes:["https://www.googleapis.com/auth/drive"]});
  return google.drive({version:"v3",auth});
}

async function driveLoad() {
  const folder=process.env.GOOGLE_DRIVE_FOLDER_ID;
  if(!folder) throw new Error("Missing GOOGLE_DRIVE_FOLDER_ID");
  const drive=driveClient();
  const name="Weekend_Tokenized_Stocks.csv";
  const list=await drive.files.list({
    q:`'${folder}' in parents and name='${name}' and trashed=false`,
    fields:"files(id,name)",pageSize:10
  });
  const file=list.data.files?.[0];
  if(!file?.id) return {folder,fileId:"",rows:[] as Row[]};
  const got=await drive.files.get({fileId:file.id,alt:"media"},{responseType:"text" as any});
  return {folder,fileId:file.id,rows:parseCsv(String(got.data ?? ""))};
}

async function driveSave(fileId:string,folder:string,csv:string) {
  const drive=driveClient();
  const body=Readable.from([csv]);
  if(fileId) {
    await drive.files.update({fileId,media:{mimeType:"text/csv",body}});
    return fileId;
  }
  const made=await drive.files.create({
    requestBody:{name:"Weekend_Tokenized_Stocks.csv",parents:[folder],mimeType:"text/csv"},
    media:{mimeType:"text/csv",body},fields:"id"
  });
  return made.data.id ?? "";
}

async function fridayClose(stock:Stock):Promise<number|null> {
  const key=process.env.TWELVE_DATA_API_KEY;
  if(!key) return null;
  const u=new URL("https://api.twelvedata.com/time_series");
  u.searchParams.set("symbol",stock); u.searchParams.set("interval","1day");
  u.searchParams.set("outputsize","10"); u.searchParams.set("apikey",key);
  const r=await fetch(u);
  if(!r.ok) return null;
  const j:any=await r.json();
  if(!Array.isArray(j.values)) return null;
  for(const item of j.values){
    const d=new Date(`${item.datetime}T12:00:00Z`);
    if(d.getUTCDay()===5){ const c=n(item.close); if(c!=null) return c; }
  }
  return null;
}

async function okx(stock:Stock) {
  const symbol=`X${stock}-USDT`;
  const r=await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${encodeURIComponent(symbol)}`);
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const d:any=(await r.json())?.data?.[0];
  if(!d) throw new Error("no data");
  return {platform:"OKX",symbol,price:n(d.last),bid:n(d.bidPx),ask:n(d.askPx),vol:n(d.volCcy24h??d.vol24h),hi:n(d.high24h),lo:n(d.low24h)};
}

async function bybit(stock:Stock) {
  const symbol=`${stock}XUSDT`;
  const r=await fetch(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${encodeURIComponent(symbol)}`);
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  const d:any=(await r.json())?.result?.list?.[0];
  if(!d) throw new Error("no data");
  return {platform:"Bybit",symbol,price:n(d.lastPrice),bid:n(d.bid1Price),ask:n(d.ask1Price),vol:n(d.turnover24h??d.volume24h),hi:n(d.highPrice24h),lo:n(d.lowPrice24h)};
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!authOk(req)) return res.status(401).json({ok:false,error:"Unauthorized"});
  const t=nowHkt();
  try{
    const text=`✅ Telegram connection test\n\nTime: ${t.timestamp} HKT\nRun ID: ${t.runId}\n\nRaw market data only — no forecast.`;
    const zip=new JSZip();
    zip.file("telegram_test.txt",text);
    const bytes=new Uint8Array(await zip.generateAsync({type:"uint8array"}));
    await tgMessage(text);
    await tgZip(bytes,`telegram_test_${t.runId}.zip`,"Telegram test package");
    return res.status(200).json({ok:true,test:"telegram",message_sent:true,zip_sent:true,run_id:t.runId});
  }catch(e:any){
    console.error(e);
    return res.status(500).json({ok:false,test:"telegram",error:String(e?.message??e)});
  }
}
