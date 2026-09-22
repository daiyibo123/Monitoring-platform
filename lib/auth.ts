import type { Env } from "./types";

// Single-account session auth. Login issues a read-only session; re-entering the
// password unlocks edit mode. On success we issue an HMAC-SHA256 signed token
// (carrying an `edit` flag) stored in an HttpOnly, Secure, SameSite=Lax cookie.
// No secret ever reaches the browser.
//
// SameSite=Lax (not Strict): a session cookie must survive top-level navigations
// into the app — bookmarks, an http→https or apex/www redirect, or arriving from
// an external link. Strict withholds the cookie on all of those, so a page reload
// that isn't a straight same-URL refresh looks unauthenticated and bounces the
// user to login. Lax still blocks the cookie on cross-site POSTs, which preserves
// CSRF protection for our state-changing routes.

const COOKIE_NAME = "rm_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const encoder = new TextEncoder();

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = "";
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64url(sig);
}

// Constant-time string comparison. Compares a hash of both sides so that length
// never leaks and a mismatch cannot be probed by timing.
async function constantTimeEqual(a: string, b: string, secret: string): Promise<boolean> {
  const [ha, hb] = await Promise.all([sign(a, secret), sign(b, secret)]);
  if (ha.length !== hb.length) return false;
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

export interface Credentials {
  username: string;
  password: string;
}

// Matches `password` against either configured password (APP_PASSWORD and the
// optional APP_PASSWORD2). Both are fully equivalent — either logs in and either
// unlocks edit mode. Both comparisons always run so timing never reveals which
// (or whether the second) password is set.
async function passwordMatches(password: string, env: Env): Promise<boolean> {
  const secret = env.SESSION_SECRET;
  const p1 = env.APP_PASSWORD || "";
  const p2 = env.APP_PASSWORD2 || "";
  const p1Ok = await constantTimeEqual(password, p1, secret);
  const p2Ok = await constantTimeEqual(password, p2, secret);
  // A blank/unset second password must never match (even an empty input).
  return p1Ok || (p2.length > 0 && p2Ok);
}

// Verify login credentials against the configured account. Returns true when the
// username matches ADMIN_USERNAME (default "admin") and the password matches
// either APP_PASSWORD or APP_PASSWORD2. Every branch does the same amount of HMAC
// work so account existence is not timing-observable.
export async function verifyCredentials(input: Credentials, env: Env): Promise<boolean> {
  const secret = env.SESSION_SECRET;
  if (!secret || !env.APP_PASSWORD) return false;

  const adminUser = env.ADMIN_USERNAME || "admin";
  const userOk = await constantTimeEqual(input.username, adminUser, secret);
  const passOk = await passwordMatches(input.password, env);
  return userOk && passOk;
}

// Verify just the password (used to unlock edit mode for an already-authed
// session). Matches either APP_PASSWORD or APP_PASSWORD2.
export async function verifyPassword(password: string, env: Env): Promise<boolean> {
  const secret = env.SESSION_SECRET;
  if (!secret || !env.APP_PASSWORD) return false;
  return passwordMatches(password, env);
}

export interface Session {
  edit: boolean;
}

export async function createSessionToken(edit: boolean, env: Env): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  const payload = base64url(encoder.encode(JSON.stringify({ exp, edit })));
  const sig = await sign(payload, env.SESSION_SECRET);
  return `${payload}.${sig}`;
}

// Returns the session if the token is valid and unexpired, else null.
export async function verifySessionToken(token: string, env: Env): Promise<Session | null> {
  if (!token || !env.SESSION_SECRET) return null;
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await sign(payload, env.SESSION_SECRET);
  // Signatures are fixed-length hex-ish base64url; simple compare is fine here
  // since both are HMAC outputs of attacker-unknown key.
  if (sig.length !== expected.length) return null;
  let diff = 0;
  for (let i = 0; i < sig.length; i++) diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(base64urlToBytes(payload)));
    if (typeof data.exp !== "number" || data.exp <= Math.floor(Date.now() / 1000)) return null;
    return { edit: data.edit === true };
  } catch {
    return null;
  }
}

export function buildSessionCookie(token: string, secure: boolean): string {
  const attrs = [`${COOKIE_NAME}=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${SESSION_TTL_SECONDS}`];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function buildClearCookie(secure: boolean): string {
  const attrs = [`${COOKIE_NAME}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) attrs.push("Secure");
  return attrs.join("; ");
}

export function readSessionCookie(request: Request): string {
  const header = request.headers.get("Cookie") || "";
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === COOKIE_NAME) return rest.join("=");
  }
  return "";
}

// Returns the session, or null if unauthenticated.
export async function getSession(request: Request, env: Env): Promise<Session | null> {
  const token = readSessionCookie(request);
  return verifySessionToken(token, env);
}

export function isSecureRequest(request: Request): boolean {
  return new URL(request.url).protocol === "https:";
}
