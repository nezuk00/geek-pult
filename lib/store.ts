import { env } from "cloudflare:workers";
import { SOURCES } from "./news";
export function db() { if (!env.DB) throw new Error("Хранилище временно недоступно."); return env.DB; }
export async function getSetting(key: string, fallback = "") { return (await db().prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{value:string}>())?.value ?? fallback; }
export function setSetting(key: string, value: string) { return db().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key, value).run(); }
export async function initialize() { await db().batch(SOURCES.map(s => db().prepare("INSERT OR IGNORE INTO sources(id) VALUES(?)").bind(s.id))); }
export async function lock(key: string, ttl = 120000) {
  const owner = `${Date.now() + ttl}:${crypto.randomUUID()}`;
  const r = await db().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(substr(settings.value,1,13) AS INTEGER) < ? RETURNING value").bind(key, owner, Date.now()).first<{value:string}>();
  return r?.value === owner ? owner : null;
}
export async function unlock(key: string, owner: string) { await db().prepare("DELETE FROM settings WHERE key=? AND value=?").bind(key, owner).run(); }
async function cipherKey() { if (!env.SETTINGS_KEY) throw new Error("Защищённое хранение токена ещё не настроено."); return crypto.subtle.importKey("raw", Uint8Array.from(atob(env.SETTINGS_KEY), c => c.charCodeAt(0)), "AES-GCM", false, ["encrypt", "decrypt"]); }
const b64 = (arr: Uint8Array) => btoa(String.fromCharCode(...arr));
export async function encrypt(value: string) { const iv = crypto.getRandomValues(new Uint8Array(12)); const data = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await cipherKey(), new TextEncoder().encode(value)); return `${b64(iv)}.${b64(new Uint8Array(data))}`; }
export async function decrypt(value: string) { const [iv, data] = value.split(".").map(x => Uint8Array.from(atob(x), c => c.charCodeAt(0))); return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await cipherKey(), data)); }
