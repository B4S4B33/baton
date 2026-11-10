import express from "express";
import fetch from "node-fetch";

const router = express.Router();

// GET /api/drive/auth-url - Get Google OAuth authorization URL
router.get("/drive/auth-url", async (req, res) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/drive/callback";
  const scope = [
    "https://www.googleapis.com/auth/drive.readonly",
    "https://www.googleapis.com/auth/drive.metadata.readonly",
  ].join(" ");

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", scope);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  res.json({ authUrl: authUrl.toString() });
});

// GET /api/drive/callback - OAuth callback (exchange code for tokens)
router.get("/drive/callback", async (req, res) => {
  const { code } = req.query;
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || "http://localhost:3000/api/drive/callback";

  try {
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });

    const tokens = await tokenRes.json();
    res.json({
      message: "Google Drive authenticated successfully",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "OAuth callback failed" });
  }
});

// POST /api/drive/ingest - Ingest Google Drive files
// Body: { accessToken: "string", folderId?: "string", leaverEmail?: "string" }
router.post("/drive/ingest", async (req, res) => {
  const { accessToken, folderId, leaverEmail } = req.body;
  if (!accessToken) {
    return res.status(400).json({ error: "accessToken is required" });
  }

  const headers = { Authorization: `Bearer ${accessToken}` };

  try {
    let saved = 0;
    let docsProcessed = 0;

    const query = folderId
      ? `'${folderId}' in parents and trashed = false`
      : "trashed = false and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation')";

    const listRes = await fetch(
      `https://www.googleapis.com/drive/v3/files?${new URLSearchParams({
        q: query,
        fields: "files(id, name, mimeType, modifiedTime, owners, webViewLink, createdTime)",
        pageSize: "100",
      })}`,
      { headers }
    );

    if (!listRes.ok) {
      return res.status(401).json({ error: "Google Drive access denied. Please re-authenticate." });
    }

    const files = (await listRes.json()).files || [];

    for (const file of files) {
      const isLeaver = leaverEmail && file.owners && file.owners.some((o) => o.emailAddress === leaverEmail);

      let content = "";
      let contentType = "document";

      if (file.mimeType === "application/vnd.google-apps.document") {
        const exportRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
          { headers }
        );
        if (exportRes.ok) {
          content = await exportRes.text();
        }
        contentType = "google_doc";
        docsProcessed++;
      } else if (file.mimeType === "application/vnd.google-apps.spreadsheet") {
        const exportRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/csv`,
          { headers }
        );
        if (exportRes.ok) {
          content = await exportRes.text();
        }
        contentType = "google_sheet";
        docsProcessed++;
      } else if (file.mimeType === "application/vnd.google-apps.presentation") {
        const exportRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`,
          { headers }
        );
        if (exportRes.ok) {
          content = await exportRes.text();
        }
        contentType = "google_slides";
        docsProcessed++;
      }

      if (!content.trim()) continue;

      const chunks = content.split(/\n\n+/).filter((c) => c.trim().length > 10);

      for (const chunk of chunks) {
        saved++;
      }

      saved++; // count the file itself
    }

    res.json({
      message: `Ingested ${docsProcessed} Google Drive documents, ${saved} content chunks`,
      docsProcessed,
      saved,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

export default router;