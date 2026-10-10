import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";

function esc(s:string){
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

export default async function handler(req:VercelRequest,res:VercelResponse){
  const clientId=process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri=process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const setupSecret=process.env.OAUTH_SETUP_SECRET;

  if(!clientId || !clientSecret || !redirectUri || !setupSecret){
    return res.status(500).send("Missing OAuth setup environment variables");
  }
  if(String(req.query.state ?? "") !== setupSecret){
    return res.status(401).send("Invalid OAuth state");
  }
  const code=String(req.query.code ?? "");
  if(!code) return res.status(400).send("Missing authorization code");

  try{
    const oauth2 = new google.auth.OAuth2(clientId,clientSecret,redirectUri);
    const {tokens}=await oauth2.getToken(code);
    const refresh=tokens.refresh_token;
    if(!refresh){
      return res.status(400).send(
        "Google did not return a refresh token. Revoke this app from your Google Account permissions, then retry /api/oauth-start with prompt=consent."
      );
    }

    res.setHeader("content-type","text/html; charset=utf-8");
    return res.status(200).send(`<!doctype html><meta name="viewport" content="width=device-width">
      <title>Google Drive OAuth Ready</title>
      <style>body{font-family:system-ui;max-width:820px;margin:40px auto;padding:0 20px;line-height:1.5}
      code,pre{background:#f4f4f4;padding:8px;border-radius:8px;overflow-wrap:anywhere}
      .warn{color:#a00;font-weight:700}</style>
      <h1>Google Drive OAuth succeeded</h1>
      <p>Copy the value below into Vercel as <code>GOOGLE_OAUTH_REFRESH_TOKEN</code>.</p>
      <pre>${esc(refresh)}</pre>
      <p class="warn">Treat this refresh token like a password. Do not paste it into ChatGPT or share it publicly.</p>
      <p>After saving it in Vercel, redeploy Production and then remove the temporary OAuth setup endpoints.</p>`);
  }catch(e:any){
    console.error(e);
    return res.status(500).send(`OAuth token exchange failed: ${esc(String(e?.message ?? e))}`);
  }
}
