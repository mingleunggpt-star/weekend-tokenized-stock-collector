import type { VercelRequest, VercelResponse } from "@vercel/node";
import { google } from "googleapis";
import { Readable } from "node:stream";

function driveClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || !refreshToken || !redirectUri) {
    throw new Error("Missing Google OAuth environment variable(s)");
  }
  const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: "v3", auth });
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) throw new Error("Missing GOOGLE_DRIVE_FOLDER_ID");
    const drive = driveClient();

    const about = await drive.about.get({ fields: "user(displayName,emailAddress,permissionId)" });

    let metadata = null, metadata_error = null;
    try {
      const m = await drive.files.get({
        fileId: folderId,
        fields: "id,name,mimeType,parents,ownedByMe,capabilities(canAddChildren,canEdit,canShare),owners(displayName,emailAddress),shortcutDetails"
      });
      metadata = m.data;
    } catch (e:any) { metadata_error = String(e?.message ?? e); }

    async function testWrite(parent?: string) {
      try {
        const name = `drive_diag_${parent ? "folder" : "root"}_${Date.now()}.txt`;
        const created = await drive.files.create({
          requestBody: parent ? { name, parents:[parent], mimeType:"text/plain" } : { name, mimeType:"text/plain" },
          media: { mimeType:"text/plain", body:Readable.from(["Drive diagnostic write test\n"]) },
          fields: "id,name,parents"
        });
        if (created.data.id) await drive.files.delete({ fileId: created.data.id });
        return { success:true, created:created.data, error:null };
      } catch (e:any) {
        return { success:false, created:null, error:String(e?.message ?? e) };
      }
    }

    const root_write_test = await testWrite();
    const folder_write_test = await testWrite(folderId);

    return res.status(200).json({
      ok:true,
      authenticated_user:about.data.user ?? null,
      target_folder:{ requested_id:folderId, metadata, metadata_error },
      root_write_test,
      folder_write_test
    });
  } catch (e:any) {
    return res.status(500).json({ ok:false, error:String(e?.message ?? e) });
  }
}
