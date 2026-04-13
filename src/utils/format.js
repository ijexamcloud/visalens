// ── src/utils/format.js ───────────────────────────────────────────────────────
// Pure string / date / score helpers. No React, no imports.
// Extracted from App.jsx (Phase 1).
// -----------------------------------------------------------------------------

// ── Case-serial helpers ───────────────────────────────────────────────────────
// Serial format: {ORG}-{CC}-{YYYYMMDD}-{INITIALS}{SEQ}
// Example:       VISION-GB-20260403-ASM0001

export function _slugify(str, maxLen = 6) {
  return (str || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, maxLen) || "ORG";
}

export function _initials(fullName, maxLen = 3) {
  const parts = (fullName || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "XX";
  return parts.slice(0, maxLen).map(p => p[0].toUpperCase()).join("");
}

export function _isoDate(d = new Date()) {
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
}

// ── Passport expiry helpers ───────────────────────────────────────────────────

/** Returns days until expiry, or null if the date string can't be parsed. */
export function daysUntilExpiry(dateStr) {
  if (!dateStr || dateStr === "Not found") return null;
  const formats = [
    /(\d{2})\.(\d{2})\.(\d{4})/,
    /(\d{4})-(\d{2})-(\d{2})/,
    /(\d{2})\/(\d{2})\/(\d{4})/,
    /(\d{2})-(\d{2})-(\d{4})/,
  ];
  let date = null;
  for (const fmt of formats) {
    const m = dateStr.match(fmt);
    if (m) {
      date = fmt === formats[1]
        ? new Date(`${m[1]}-${m[2]}-${m[3]}`)
        : new Date(`${m[3]}-${m[2]}-${m[1]}`);
      break;
    }
  }
  if (!date || isNaN(date)) return null;
  return Math.floor((date - new Date()) / 86400000);
}

// ── Score colour / badge helpers ──────────────────────────────────────────────

export function scoreCol(s)   { return s >= 70 ? "#059669" : s >= 45 ? "#B45309" : "#DC2626"; }
export function scoreBadge(s) { return s >= 70 ? "b-ok"    : s >= 45 ? "b-warn"  : "b-err"; }
export function scoreLabel(s) { return s >= 70 ? "Strong"  : s >= 45 ? "Moderate": "Weak"; }
