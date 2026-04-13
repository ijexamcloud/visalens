// ── src/utils/mrz.js ─────────────────────────────────────────────────────────
// ICAO Doc 9303 MRZ check-digit validation and passport-number validation.
// Pure functions, no imports.
// Extracted from App.jsx (Phase 1).
// -----------------------------------------------------------------------------

/**
 * Returns the numeric value of an MRZ character as per ICAO Doc 9303:
 *   0-9  → face value
 *   A-Z  → 10-35 (charCode - 55)
 *   < or filler → 0
 */
export function mrzCharValue(ch) {
  if (ch >= "0" && ch <= "9") return parseInt(ch, 10);
  if (ch >= "A" && ch <= "Z") return ch.charCodeAt(0) - 55;
  return 0;
}

/**
 * Computes the MRZ check digit for an arbitrary string using
 * repeating weights [7, 3, 1], returning result mod 10.
 */
export function mrzComputeCheckDigit(str) {
  const weights = [7, 3, 1];
  let total = 0;
  for (let i = 0; i < str.length; i++) {
    total += mrzCharValue(str[i]) * weights[i % 3];
  }
  return total % 10;
}

/**
 * Validates a passport number string.
 *
 * Returns one of:
 *   "empty"        — blank / "Not found"
 *   "format_error" — doesn't match ^[A-Z]{2}[0-9]{7}$
 *   "suspicious"   — passes format but looks like a placeholder
 *   { status: "valid", checkDigit: number, formatted: string }
 *
 * Note: We only have the 9-char passport number, not the full MRZ line,
 * so we validate FORMAT and compute the *expected* check digit for display.
 * The actual check digit lives in position 10 of the MRZ line 2, which
 * the AI extraction doesn't capture separately.
 */
export function validatePassportNumber(pn) {
  if (!pn || pn === "Not found" || pn === "") return "empty";
  const cleaned = pn.trim().toUpperCase();
  if (!/^[A-Z]{2}[0-9]{7}$/.test(cleaned)) return "format_error";

  const digits = cleaned.slice(2);
  if (/^(\d)\1{6}$/.test(digits)) return "suspicious"; // all same digit
  if (digits === "1234567" || digits === "7654321") return "suspicious";

  const expectedCheckDigit = mrzComputeCheckDigit(cleaned);
  return { status: "valid", checkDigit: expectedCheckDigit, formatted: cleaned };
}
