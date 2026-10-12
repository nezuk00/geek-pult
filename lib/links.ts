const BLOCKED_EDITORIAL_HOSTS = ["news.google.com", "t.me", "telegram.me", "telegram.dog", "telegram.org", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "youtube.com", "youtu.be", "reddit.com", "wikipedia.org"];
export function publicHttpsUrl(value: string): string | null {
  try {
    const u = new URL(value.trim()); const host = u.hostname.toLowerCase();
    if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443") || !host.includes(".") || host.includes(":") || /^\d+(?:\.\d+)*$/.test(host) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return null;
    u.hash = ""; return u.href;
  } catch { return null; }
}
export function newsArticleUrl(value: string): string | null {
  const safe = publicHttpsUrl(value); if (!safe) return null; const u = new URL(safe);
  if (BLOCKED_EDITORIAL_HOSTS.some(d => u.hostname === d || u.hostname.endsWith("." + d)) || u.pathname === "/") return null;
  for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
  return u.href;
}
export function hasTelegramLink(text: string) {
  let decoded = text; try { decoded = decodeURIComponent(text); } catch {}
  return /(?:\b(?:t\.me|telegram\.me|telegram\.dog|telegram\.org)(?::\d+)?\s*[\/?#]|tg:\/\/)/i.test(decoded.replace(/[\u200b-\u200f\u2060\ufeff]/g, ""));
}
export function photoCaption(text: string, source: string, credit = "") {
  if (hasTelegramLink(text) || hasTelegramLink(credit)) throw new Error("В публикуемом посте не должно быть ссылок на Telegram-каналы.");
  const url = newsArticleUrl(source); if (!url) throw new Error("Нужна ссылка на статью новостного сайта. Ссылка на Telegram не подходит.");
  const result = `${text.trim()}\n\nИсточник: ${url}${credit.trim() ? `\nФото: ${credit.trim()}` : ""}`;
  if (result.length > 1024) throw new Error(`Подпись к картинке слишком длинная: ${result.length}/1024 символов вместе со ссылкой. Сократите текст.`);
  return result;
}
