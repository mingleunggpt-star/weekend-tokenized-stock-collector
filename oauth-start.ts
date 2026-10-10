import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";

export default async function handler(req:VercelRequest,res:VercelResponse){
  const clientId=process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret=process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri=process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const setupSecret=process.env.OAUTH_SETUP_SECRET;

  if(!clientId || !clientSecret || !redirectUri || !setupSecret){
    return res.status(500).json({ok:false,error:"Missing OAuth setup environment variables"});
  }

  const supplied=String(req.query.secret ?? "");
  if(supplied !== setupSecret) return res.status(401).json({ok:false,error:"Unauthorized"});

  const oauth2 = new google.auth.OAuth2(clientId,clientSecret,redirectUri);
  const url = oauth2.generateAuthUrl({
    access_type:"offline",
    prompt:"consent",
    scope:["https://www.googleapis.com/auth/drive"],
    state:setupSecret,
    include_granted_scopes:true
  });
  return res.redirect(302,url);
}
