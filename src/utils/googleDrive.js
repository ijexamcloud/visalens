// ── src/utils/googleDrive.js ─────────────────────────────────────────────────
// Google Drive: token management, Drive Picker, file download & upload.
// All functions are self-contained — no React, no Supabase.
// Extracted from App.jsx (Phase 1).
// -----------------------------------------------------------------------------

const GOOGLE_API_KEY   = import.meta.env.VITE_GOOGLE_API_KEY;
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const DRIVE_SCOPES     = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly";
const PICKER_APP_ID    = GOOGLE_CLIENT_ID ? GOOGLE_CLIENT_ID.split("-")[0] : "";
const DRIVE_FOLDER_NAME = "VisaLens Reports";

export const DRIVE_TOKEN_KEY = "visalens_gdrive_token";

// ── Script loader ─────────────────────────────────────────────────────────────

export function loadGoogleScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const s = document.createElement("script");
    s.src = src; s.async = true; s.defer = true;
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
}

// ── Preload state ─────────────────────────────────────────────────────────────
// Mutable module-level singletons — intentional (same pattern as before).

let _gsiReady      = false;
let _gapiReady     = false;
let _pickerReady   = false;
let _tokenClient   = null;
let _preloadPromise = null;

/**
 * Called on app mount AND on button hover/touch — loads all scripts silently
 * in the background so the actual tap handler has zero async work before
 * requestAccessToken(), which Safari requires to trust the popup as user-initiated.
 */
export function preloadDriveScripts() {
  if (_preloadPromise) return _preloadPromise;
  _preloadPromise = (async () => {
    try {
      await Promise.all([
        loadGoogleScript("https://accounts.google.com/gsi/client")
          .then(() => { _gsiReady = true; }),
        loadGoogleScript("https://apis.google.com/js/api.js")
          .then(() => new Promise(res =>
            window.gapi.load("picker", () => { _gapiReady = true; _pickerReady = true; res(); })
          )),
      ]);
    } catch {}
  })();
  return _preloadPromise;
}

// ── Token management ──────────────────────────────────────────────────────────

/**
 * Returns a valid Google OAuth access token.
 * Scripts are preloaded so this function only does a token cache check
 * (synchronous) then calls requestAccessToken — no awaits block it from the tap.
 * Safari fix: requestAccessToken MUST be called synchronously from a user gesture.
 */
export async function getAccessToken(forcePrompt = false) {
  if (!_gsiReady) {
    await loadGoogleScript("https://accounts.google.com/gsi/client");
    _gsiReady = true;
  }
  if (!forcePrompt) {
    try {
      const stored = sessionStorage.getItem(DRIVE_TOKEN_KEY);
      if (stored) {
        const t = JSON.parse(stored);
        if (t.expires_at > Date.now() + 60000) return t.access_token;
      }
    } catch {}
  }
  return new Promise((resolve, reject) => {
    _tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPES,
      callback: (resp) => {
        if (resp.error) { reject(new Error(resp.error)); return; }
        const token = {
          access_token: resp.access_token,
          expires_at: Date.now() + (resp.expires_in || 3600) * 1000,
        };
        try { sessionStorage.setItem(DRIVE_TOKEN_KEY, JSON.stringify(token)); } catch {}
        resolve(resp.access_token);
      },
    });
    _tokenClient.requestAccessToken({ prompt: forcePrompt ? "consent" : "" });
  });
}

export function clearDriveToken() {
  try { sessionStorage.removeItem(DRIVE_TOKEN_KEY); } catch {}
}

export function hasDriveToken() {
  try {
    const stored = sessionStorage.getItem(DRIVE_TOKEN_KEY);
    if (!stored) return false;
    const t = JSON.parse(stored);
    return t.expires_at > Date.now() + 60000;
  } catch { return false; }
}

// ── Drive Picker ──────────────────────────────────────────────────────────────

/**
 * Opens the Google Drive file picker (Safari-safe).
 * Scripts are already loaded from preload — no awaits before getAccessToken().
 * @param {function} onFilePicked  Called with an array of Drive doc objects,
 *                                 or [] if the user cancelled.
 */
export async function openDrivePicker(onFilePicked) {
  if (!_gapiReady) {
    await loadGoogleScript("https://apis.google.com/js/api.js");
    await new Promise(res => window.gapi.load("picker", () => { _gapiReady = true; _pickerReady = true; res(); }));
  }
  const token = await getAccessToken();

  const docsView = new window.google.picker.DocsView()
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false)
    .setMimeTypes("application/pdf,image/jpeg,image/png,image/jpg,text/plain");

  const picker = new window.google.picker.PickerBuilder()
    .setAppId(PICKER_APP_ID)
    .setOAuthToken(token)
    .setDeveloperKey(GOOGLE_API_KEY)
    .addView(docsView)
    .setTitle("Select documents to import")
    .enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED)
    .setCallback(async (data) => {
      if (data.action === window.google.picker.Action.PICKED) {
        onFilePicked(data.docs);
      } else if (data.action === window.google.picker.Action.CANCEL) {
        onFilePicked([]);
      }
    })
    .build();
  picker.setVisible(true);
}

// ── Download ──────────────────────────────────────────────────────────────────

/** Downloads a Drive file as a Blob. */
export async function downloadDriveFile(fileId, mimeType, token) {
  const url = `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`;
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Drive download failed: ${resp.status} — ${errText}`);
  }
  return await resp.blob();
}

// ── Upload helpers ────────────────────────────────────────────────────────────

/** Finds or creates the "VisaLens Reports" root folder; returns its Drive ID. */
export async function getDriveRootFolderId(token) {
  const searchResp = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${DRIVE_FOLDER_NAME}' and trashed=false`)}&fields=files(id,name)`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const searchData = await searchResp.json();
  if (searchData.files?.length > 0) return searchData.files[0].id;

  const createResp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: DRIVE_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" }),
  });
  const created = await createResp.json();
  return created.id;
}

/** Creates a subfolder inside a parent Drive folder; returns its Drive ID. */
export async function createDriveSubfolder(token, parentId, folderName) {
  const resp = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: folderName, mimeType: "application/vnd.google-apps.folder", parents: [parentId] }),
  });
  const data = await resp.json();
  return data.id;
}

/** Uploads a File/Blob to a specific Drive folder; returns the Drive file metadata. */
export async function uploadFileToDrive(token, folderId, file, filename) {
  const metadata = { name: filename, parents: [folderId] };
  const form = new FormData();
  form.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
  form.append("file", file);
  const resp = await fetch(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
    { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form }
  );
  return await resp.json();
}
