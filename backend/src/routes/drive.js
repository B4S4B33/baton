import express from "express";
import fetch from "node-fetch";
import { extractClaims, scoreConfidence } from "../services/llm.js";
import { createClaim, createSource } from "../services/neo4jService.js";
import { claims, sources } from "../store.js";

const router = express.Router();

const DRIVE_API = "https://www.googleapis.com/drive/v3";
const DRIVE_EXPORT_MIME = {
  "application/vnd.google-apps.document": { mime: "text/plain", contentType: "google_doc" },
  "application/vnd.google-apps.spreadsheet": { mime: "text/csv", contentType: "google_sheet" },
  "application/vnd.google-apps.presentation": { mime: "text/plain", contentType: "google_slides" },
};
const FOLDER_MIME = "application/vnd.google-apps.folder";

const FILE_FIELDS = [
  "id", "name", "mimeType", "modifiedTime", "createdTime", "owners(emailAddress,displayName)",
  "webViewLink", "parents", "driveId", "permissionIds",
  "capabilities(canRead,canDownload,canShare,canCopy)",
  "permissions(id,type,role,emailAddress,domain,displayName,allowFileDiscovery,deleted,expirationTime,permissionDetails(permissionType,role,inherited,inheritedFrom))",
].join(",");

const LIST_FIELDS = `nextPageToken,files(${FILE_FIELDS})`;

function mapClaimType(llmType) {
  const key = String(llmType || "").toUpperCase();
  const typeMap = {
    DECISION: "decision", DECISIONS: "decision",
    OPENQUESTION: "question", OPENQUESTIONS: "question", OPEN_QUESTION: "question", OPEN_QUESTIONS: "question",
    TASK: "task", TASKS: "task",
    DEPENDENCY: "dependency", DEPENDENCIES: "dependency",
    RISK: "risk", RISKS: "risk",
    CONTACT: "contact", CONTACTS: "contact",
  };
  return typeMap[key] || "decision";
}

async function extractClaimsFromText(text, sourceType) {
  if (!text || text.trim().length < 10) return [];
  try {
    const extracted = await extractClaims(text, sourceType);
    const extractedClaims = [];
    for (const [key, value] of Object.entries(extracted || {})) {
      if (!Array.isArray(value)) continue;
      for (const item of value) {
        const claimText = typeof item === "string" ? item : item?.text || item?.title || JSON.stringify(item);
        const claimType = mapClaimType(key);
        let confidence = 0.7;
        try {
          const score = await scoreConfidence(claimText, sourceType, new Date().toISOString(), 1);
          confidence = Math.max(0, Math.min(1, score?.score || 0.7));
        } catch (e) {
          console.warn("Confidence scoring failed:", e.message);
        }
        extractedClaims.push({ text: claimText, type: claimType, confidence, sourceType });
      }
    }
    return extractedClaims;
  } catch (e) {
    console.warn("LLM extraction failed:", e.message);
    return [];
  }
}

async function safeCreateClaim(claim) {
  try { return await createClaim(claim); }
  catch (e) { claims.push(claim); return claim; }
}

async function safeCreateSource(source) {
  try { return await createSource(source); }
  catch (e) {
    const idx = sources.findIndex((s) => s.url === source.url || (source.fileId && s.fileId === source.fileId));
    if (idx >= 0) sources[idx] = { ...sources[idx], ...source };
    else sources.push(source);
    return source;
  }
}

async function driveFetchJson(url, headers) {
  const res = await fetch(url, { headers });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || res.statusText;
    const err = new Error(`Drive API ${res.status}: ${msg}`);
    err.status = res.status;
    err.details = data;
    throw err;
  }
  return data || {};
}

function normalizePermission(p) {
  const details = Array.isArray(p?.permissionDetails) ? p.permissionDetails : [];
  const inherited = details.some((d) => d?.inherited === true) || Boolean(p?.inherited);
  const inheritedFromIds = [...new Set(details.map((d) => d?.inheritedFrom).filter(Boolean))];
  return {
    id: p?.id || null,
    type: p?.type || null, // user|group|domain|anyone
    role: p?.role || null, // owner|organizer|fileOrganizer|writer|commenter|reader
    emailAddress: p?.emailAddress || null,
    domain: p?.domain || null,
    displayName: p?.displayName || null,
    allowFileDiscovery: p?.allowFileDiscovery,
    deleted: p?.deleted,
    expirationTime: p?.expirationTime || null,
    inherited,
    inheritedFrom: inheritedFromIds,
    permissionDetails: details.map((d) => ({
      permissionType: d?.permissionType || null,
      role: d?.role || null,
      inherited: Boolean(d?.inherited),
      inheritedFrom: d?.inheritedFrom || null,
    })),
  };
}

async function fetchInheritedFromNames(ids, headers, cache) {
  const names = {};
  const unique = [...new Set((ids || []).filter(Boolean))];
  for (const id of unique) {
    if (cache.has(id)) { names[id] = cache.get(id); continue; }
    try {
      const meta = await driveFetchJson(
        `${DRIVE_API}/files/${encodeURIComponent(id)}?${new URLSearchParams({ fields: "id,name,mimeType,webViewLink,driveId", supportsAllDrives: "true" })}`,
        headers
      );
      const info = { id: meta.id, name: meta.name || null, mimeType: meta.mimeType || null, webViewLink: meta.webViewLink || null };
      cache.set(id, info);
      names[id] = info;
    } catch (e) {
      cache.set(id, { id, name: null, unresolved: true, error: e.message });
      names[id] = cache.get(id);
    }
  }
  return names;
}

async function buildAclSnapshot(file, headers, inheritedNameCache) {
  const permissions = Array.isArray(file?.permissions) ? file.permissions.map(normalizePermission) : [];
  const allInheritedFrom = permissions.flatMap((p) => p.inheritedFrom || []);
  const inheritedFromNames = await fetchInheritedFromNames(allInheritedFrom, headers, inheritedNameCache);

  for (const p of permissions) {
    p.inheritedFromDetails = (p.inheritedFrom || []).map((id) => inheritedFromNames[id] || { id });
  }

  const anyone = permissions.some((p) => p.type === "anyone" && !p.deleted);
  const domainRestricted = permissions.filter((p) => p.type === "domain" && !p.deleted).map((p) => p.domain).filter(Boolean);
  const directCount = permissions.filter((p) => !p.inherited).length;
  const inheritedCount = permissions.filter((p) => p.inherited).length;

  return {
    version: 1,
    source: "google_drive",
    fetchedAt: new Date().toISOString(),
    fileId: file.id,
    fileName: file.name || null,
    mimeType: file.mimeType || null,
    webViewLink: file.webViewLink || null,
    driveId: file.driveId || null,
    parents: Array.isArray(file.parents) ? file.parents : [],
    owners: Array.isArray(file.owners) ? file.owners.map((o) => ({ emailAddress: o.emailAddress || null, displayName: o.displayName || null })) : [],
    capabilities: file.capabilities || null,
    permissions,
    summary: {
      totalPermissions: permissions.length,
      directCount,
      inheritedCount,
      anyoneAccessible: anyone,
      domainRestricted: [...new Set(domainRestricted)],
      hasInheritedPermissions: inheritedCount > 0,
    },
  };
}

async function listDriveFiles(headers, params) {
  const items = [];
  let pageToken = null;
  do {
    const q = new URLSearchParams({
      fields: LIST_FIELDS,
      pageSize: "100",
      supportsAllDrives: "true",
      includeItemsFromAllDrives: "true",
      ...params,
    });
    if (pageToken) q.set("pageToken", pageToken);
    const data = await driveFetchJson(`${DRIVE_API}/files?${q}`, headers);
    items.push(...(Array.isArray(data.files) ? data.files : []));
    pageToken = data.nextPageToken || null;
  } while (pageToken);
  return items;
}

async function collectSupportedFiles(headers, { folderId, recursive = true }) {
  const supported = [];
  const seen = new Set();

  async function walk(currentFolderId, path = []) {
    const query = `'${currentFolderId}' in parents and trashed = false`;
    const files = await listDriveFiles(headers, { q: query });
    for (const file of files) {
      if (!file?.id || seen.has(file.id)) continue;
      seen.add(file.id);
      if (file.mimeType === FOLDER_MIME && recursive) {
        await walk(file.id, [...path, { id: file.id, name: file.name }]);
      } else if (DRIVE_EXPORT_MIME[file.mimeType]) {
        supported.push({ ...file, _folderPath: path });
      }
    }
  }

  if (folderId) {
    await walk(folderId, []);
    return supported;
  }

  const q = "trashed = false and (mimeType = 'application/vnd.google-apps.document' or mimeType = 'application/vnd.google-apps.spreadsheet' or mimeType = 'application/vnd.google-apps.presentation')";
  const files = await listDriveFiles(headers, { q });
  for (const file of files) {
    if (!file?.id || seen.has(file.id)) continue;
    seen.add(file.id);
    if (DRIVE_EXPORT_MIME[file.mimeType]) supported.push(file);
  }
  return supported;
}

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
      expiresIn: tokens.expires_in,
      tokenType: tokens.token_type,
      scope: tokens.scope,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "OAuth callback failed", details: e.message });
  }
});

// POST /api/drive/ingest - Ingest Google Drive files with permission/ACL snapshots
// Body: { accessToken: "string", folderId?: "string", leaverEmail?: "string", recursive?: boolean }
router.post("/drive/ingest", async (req, res) => {
  const { accessToken, folderId, leaverEmail, recursive = true } = req.body || {};
  if (!accessToken) {
    return res.status(400).json({ error: "accessToken is required" });
  }

  const headers = { Authorization: `Bearer ${accessToken}` };
  const inheritedNameCache = new Map();
  const diagnostics = {
    filesDiscovered: 0,
    docsProcessed: 0,
    claimsSaved: 0,
    sourcesSaved: 0,
    aclSnapshotsCaptured: 0,
    filesWithInheritedPermissions: 0,
    permissionFetchWarnings: [],
    exportWarnings: [],
  };

  try {
    const files = await collectSupportedFiles(headers, { folderId, recursive: recursive !== false });
    diagnostics.filesDiscovered = files.length;

    for (const file of files) {
      const exportInfo = DRIVE_EXPORT_MIME[file.mimeType];
      if (!exportInfo) continue;

      const ownerEmails = Array.isArray(file.owners) ? file.owners.map((o) => o.emailAddress).filter(Boolean) : [];
      const isLeaver = Boolean(leaverEmail && ownerEmails.includes(leaverEmail));

      let acl = null;
      try {
        acl = await buildAclSnapshot(file, headers, inheritedNameCache);
        diagnostics.aclSnapshotsCaptured++;
        if (acl?.summary?.hasInheritedPermissions) diagnostics.filesWithInheritedPermissions++;
      } catch (e) {
        diagnostics.permissionFetchWarnings.push({ fileId: file.id, fileName: file.name, error: e.message });
      }

      let content = "";
      try {
        const exportRes = await fetch(
          `${DRIVE_API}/files/${encodeURIComponent(file.id)}/export?${new URLSearchParams({ mimeType: exportInfo.mime })}`,
          { headers }
        );
        if (exportRes.ok) content = await exportRes.text();
        else diagnostics.exportWarnings.push({ fileId: file.id, fileName: file.name, status: exportRes.status });
      } catch (e) {
        diagnostics.exportWarnings.push({ fileId: file.id, fileName: file.name, error: e.message });
      }

      if (!content || !String(content).trim()) continue;
      diagnostics.docsProcessed++;

      const extractedClaims = await extractClaimsFromText(content, exportInfo.contentType);
      const claimsToSave = extractedClaims.length > 0 ? extractedClaims : [{
        text: String(content).substring(0, 200),
        type: exportInfo.contentType,
        confidence: 0.7,
        sourceType: exportInfo.contentType,
      }];

      const sourceUrl = file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
      const createdAt = file.createdTime || file.modifiedTime || new Date().toISOString();
      const author = ownerEmails[0] || file.owners?.[0]?.displayName || "Unknown";

      for (const claim of claimsToSave) {
        await safeCreateClaim({
          id: `drive-${file.id}-${claims.length + diagnostics.claimsSaved}`,
          type: claim.type,
          text: claim.text,
          confidence: claim.confidence,
          status: "proposed",
          sourceUrl,
          sourceType: "drive_file",
          createdAt,
          author,
          isLeaver,
          fileName: file.name,
          fileId: file.id,
          access: acl ? {
            hasAclSnapshot: true,
            inheritedPermissions: acl.summary?.inheritedCount || 0,
            directPermissions: acl.summary?.directCount || 0,
            anyoneAccessible: Boolean(acl.summary?.anyoneAccessible),
            domainRestricted: acl.summary?.domainRestricted || [],
          } : { hasAclSnapshot: false },
          proof: {
            type: "google_drive_file",
            fileId: file.id,
            fileName: file.name,
            mimeType: file.mimeType,
            webViewLink: file.webViewLink,
            ownerEmails,
            driveId: file.driveId || null,
            parents: file.parents || [],
            isLeaver,
            aclFetchedAt: acl?.fetchedAt || null,
            inheritedPermissionCount: acl?.summary?.inheritedCount || 0,
          },
        });
        diagnostics.claimsSaved++;
      }

      await safeCreateSource({
        url: sourceUrl,
        type: exportInfo.contentType,
        content: String(content).substring(0, 1000),
        author,
        fileName: file.name,
        fileId: file.id,
        mimeType: file.mimeType,
        webViewLink: file.webViewLink,
        parents: Array.isArray(file.parents) ? file.parents : [],
        driveId: file.driveId || null,
        ownerEmails,
        acl,
        aclFetchedAt: acl?.fetchedAt || null,
        createdAt,
      });
      diagnostics.sourcesSaved++;
    }

    res.json({
      message: `Ingested ${diagnostics.docsProcessed} Google Drive documents, ${diagnostics.claimsSaved} claims extracted`,
      ...diagnostics,
      totalClaims: claims.length,
    });
  } catch (e) {
    console.error(e);
    const status = e.status === 401 || e.status === 403 ? 401 : (e.status || 500);
    res.status(status).json({
      error: status === 401 ? "Google Drive access denied. Please re-authenticate." : (e.message || "Drive ingestion failed"),
      details: e.details || null,
      diagnostics,
    });
  }
});

export default router;