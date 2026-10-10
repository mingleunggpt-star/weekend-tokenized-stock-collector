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
  return true; // TEMPORARY public one-time test endpoint. Delete after testing.
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
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  f.append("document",new Blob([ab],{type:"application/zip"}),name);
  const r=await fetch(`https://api.telegram.org/bot${token}/sendDocument`,{method:"POST",body:f});
  if(!r.ok) throw new Error(`Telegram sendDocument ${r.status}: ${await r.text()}`);
}

function driveClient() {
  const clientId=process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken=process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const redirectUri=process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if(!clientId) throw new Error("Missing GOOGLE_OAUTH_CLIENT_ID");
  if(!clientSecret) throw new Error("Missing GOOGLE_OAUTH_CLIENT_SECRET");
  if(!refreshToken) throw new Error("Missing GOOGLE_OAUTH_REFRESH_TOKEN");
  if(!redirectUri) throw new Error("Missing GOOGLE_OAUTH_REDIRECT_URI");
  const auth=new google.auth.OAuth2(clientId,clientSecret,redirectUri);
  auth.setCredentials({refresh_token:refreshToken});
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

async function collectRows():Promise<Row[]> {
  const t=nowHkt(); const rows:Row[]=[];
  for(const stock of STOCKS){
    const close=await fridayClose(stock);
    for(const source of [okx,bybit]){
      try{
        const d=await source(stock);
        rows.push({
          timestamp_hkt:t.timestamp,date:t.date,day:t.day,platform:d.platform,stock,
          token_symbol:d.symbol,friday_close:close?.toString()??"",
          token_price:d.price?.toString()??"",bid:d.bid?.toString()??"",ask:d.ask?.toString()??"",
          spread_pct:spread(d.bid,d.ask),volume_24h:d.vol?.toString()??"",
          high_24h:d.hi?.toString()??"",low_24h:d.lo?.toString()??"",
          vs_friday_pct:vsFriday(d.price,close),run_id:t.runId,
          data_status:d.price==null?"PRICE_MISSING":close==null?"FRIDAY_CLOSE_MISSING":"OK"
        });
      }catch(e:any){
        const platform=source===okx?"OKX":"Bybit";
        const symbol=platform==="OKX"?`X${stock}-USDT`:`${stock}XUSDT`;
        rows.push({
          timestamp_hkt:t.timestamp,date:t.date,day:t.day,platform,stock,token_symbol:symbol,
          friday_close:close?.toString()??"",token_price:"",bid:"",ask:"",spread_pct:"",
          volume_24h:"",high_24h:"",low_24h:"",vs_friday_pct:"",run_id:t.runId,
          data_status:`FETCH_ERROR:${String(e?.message??e)}`.slice(0,120)
        });
      }
    }
  }
  return rows;
}

function summary(rows:Row[]){
  const t=nowHkt(); const lines=[`Weekend Tokenized Stocks — ${t.timestamp} HKT`,""];
  for(const stock of STOCKS){
    const a=rows.filter(r=>r.stock===stock);
    const r=a.find(x=>x.data_status==="OK")??a[0];
    if(!r){lines.push(`${stock} — NO_DATA`);continue;}
    lines.push(`${stock} | ${r.platform} | px ${r.token_price||"-"} | vs Fri ${r.vs_friday_pct?`${r.vs_friday_pct}%`:"-"} | vol ${r.volume_24h||"-"} | spread ${r.spread_pct?`${r.spread_pct}%`:"-"} | ${r.data_status}`);
  }
  lines.push("","Raw market data only — no forecast.");
  return lines.join("\n");
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  if(!authOk(req)) return res.status(401).json({ok:false,error:"Unauthorized"});
  const t=nowHkt();
  try{
    const fresh=await collectRows();
    const loaded=await driveLoad();
    const merged=dedupe([...loaded.rows,...fresh]);
    const masterCsv=rowsToCsv(merged);
    const fileId=await driveSave(loaded.fileId,loaded.folder,masterCsv);
    const text=summary(fresh);
    const zip=new JSZip();
    zip.file(`latest_run_${t.runId}.csv`,rowsToCsv(fresh));
    zip.file("Weekend_Tokenized_Stocks_master.csv",masterCsv);
    zip.file(`telegram_summary_${t.runId}.txt`,text);
    zip.file(`run_${t.runId}.json`,JSON.stringify({run_id:t.runId,timestamp_hkt:t.timestamp,rows:fresh.length},null,2));
    const bytes=new Uint8Array(await zip.generateAsync({type:"uint8array",compression:"DEFLATE"}));
    await tgMessage(text);
    await tgZip(bytes,`Weekend_Tokenized_Stocks_${t.runId}.zip`,"Weekend Tokenized Stocks data package");
    return res.status(200).json({ok:true,run_id:t.runId,rows_collected:fresh.length,master_rows:merged.length,drive_file_id:fileId,telegram_sent:true});
  }catch(e:any){
    console.error(e);
    return res.status(500).json({ok:false,run_id:t.runId,error:String(e?.message??e)});
  }
}
