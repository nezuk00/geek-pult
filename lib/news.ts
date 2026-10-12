export type Topic = "Игры" | "Геймдев" | "Аниме" | "Сериалы" | "Пользовательская";
export type Source = { id: string; name: string; url: string; home: string; kind: "rss" | "telegram"; topic: Topic; description: string; animeOnly?: boolean; automatic?: boolean };
export const INTERVAL_MINUTES = 120;
export const FEATURE_MAX_HOURS = 30 * 24;
export function topicSearchSource(theme: string): Source {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", theme);
  url.searchParams.set("hl", "ru");
  url.searchParams.set("gl", "RU");
  url.searchParams.set("ceid", "RU:ru");
  return { id: "topic-search", name: `Автопоиск: ${theme}`, url: url.href, home: "https://news.google.com/", kind: "rss", topic: "Пользовательская", automatic: true, description: "Поиск новостных публикаций по заданной теме через RSS Google News" };
}
export const SOURCES: Source[] = [
  { id: "animecorner", name: "Anime Corner", url: "https://animecorner.me/feed/", home: "https://animecorner.me", kind: "rss", topic: "Аниме", animeOnly:true, description: "Необычные тайтлы, интервью с авторами и новости аниме" },
  { id: "sakugablog", name: "Sakuga Blog", url: "https://blog.sakugabooru.com/feed/", home: "https://blog.sakugabooru.com/", kind: "rss", topic: "Аниме", animeOnly:true, description: "Аниматоры, режиссёры и истории создания аниме" },
  ...[
    ["ru2chvg", "VG / Двач"], ["nerds", "Нерды"], ["gcapixel", "Gamers Club"],
    ["pekagame", "Пекарня"], ["stopgamenews", "StopGame — новости"],
  ].map(([id,name]):Source=>({id,name,url:`https://t.me/s/${id}`,home:`https://t.me/${id}`,kind:"telegram",topic:"Аниме",description:"Только аниме и манга из общей ленты; подтверждение ищем на новостном сайте"})),
];
export type Rubric = "Новости" | "Что смотреть" | "Споры фандома" | "Факты и закулисье";
export function rubric(title:string, excerpt=""):Rubric {
  const text=`${title} ${excerpt}`;
  if(/controvers|backlash|harass|apolog|debate|outrage|скандал|травл|извин|спор|срач/i.test(text))return "Споры фандома";
  if(/interview|production notes|behind.the.scenes|интервью|закулис|как созда|факт из архива/i.test(title))return "Факты и закулисье";
  if(/review|recommend|what to watch|обзор|рекоменд|что посмотр|стоит смотр/i.test(title))return "Что смотреть";
  return "Новости";
}
export function isAnimeStory(title:string,excerpt:string,source:Source) {
  if (source.id === "topic-search") return true;
  const text=`${title} ${excerpt}`;
  if(source.animeOnly){
    const explicitAnime=/\banime\b|\bmanga\b|аниме|манг[аиуе]/i.test(title);
    if(/\b(k-pop|kpop|vtuber|hololive|nijisanji|xbox|playstation|steam|game|gaming)\b|видеоигр/i.test(title)&&!explicitAnime)return false;
    return true;
  }
  return /\banime\b|\bmanga\b|\bmangaka\b|\bseiyuu\b|аниме|манг[аиуе]|мангак|сэйю|сейю|наруто|ван[ -]?пис|человек.бензопила|джуджутсу|магическ\w* битв|клинок.*демон|one piece|naruto|chainsaw man|jujutsu kaisen|demon slayer|frieren|фрирен/i.test(text);
}
export function freshEnough(title:string,excerpt:string,publishedAt:string,now=Date.now()) {
  const age=(now-Date.parse(publishedAt))/3600000;
  return Number.isFinite(age)&&age>=-1/6&&age<=(rubric(title,excerpt)==="Факты и закулисье"?FEATURE_MAX_HOURS:36);
}
export type Candidate = { title: string; excerpt: string; url: string; publishedAt: string; topic: Topic; sourceId: string; score: number; reason: string };
export function plain(value: string): string {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/p>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_, n) => { const c = n[0].toLowerCase() === "x" ? parseInt(n.slice(1), 16) : Number(n); return c > 0 && c <= 0x10ffff ? String.fromCodePoint(c) : ""; })
    .replace(/&(amp|lt|gt|quot|apos|nbsp|ndash|mdash|hellip);/g, (_, n: string) => ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…" }[n] || ""))
    .replace(/[\t \u00a0]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}
export function canonicalUrl(input: string): string | null {
  try { const u = new URL(input.replace(/&amp;/g, "&").trim()); if (u.protocol !== "https:") return null; u.hash = "";
    for (const key of [...u.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) u.searchParams.delete(key);
    return u.href;
  } catch { return null; }
}
function tag(block: string, name: string) { return block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || ""; }
export function titleTokens(title: string) { return new Set(plain(title).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(w => w.length > 2 && !["the", "and", "for", "with", "new", "для", "как", "что", "это"].includes(w))); }
export function sameStory(a: string, b: string) {
  const x = titleTokens(a), y = titleTokens(b); if (!x.size || !y.size) return false;
  const intersection = [...x].filter(t => y.has(t)).length; return intersection / (x.size + y.size - intersection) >= .72;
}
export function grade(title: string, excerpt: string, source: Source, publishedAt: string, now = Date.now()) {
  const text = `${title} ${excerpt}`.toLowerCase(); const age = (now - Date.parse(publishedAt)) / 3600000;
  let score = 46 + Math.max(0, 22 - age); const reasons: string[] = [];
  if (age <= 6) reasons.push("Свежий инфоповод");
  const kind=rubric(title,excerpt); reasons.push(kind);
  if(kind==="Факты и закулисье"){score+=27;if(age>36)reasons.push("Архивный материал — не срочная новость");}
  if(kind==="Что смотреть"){score+=22;reasons.push("Повод рассказать о тайтле");}
  if(kind==="Споры фандома"){score+=12;reasons.push("Нужны оригинальные высказывания и контекст");}
  if (/comedy|absurd|bizarre|unusual|комеди|абсурд|необыч|смешн/i.test(text)) { score += 12; reasons.push("Необычный сюжет"); }
  if (/announc|premiere|trailer|анонс|премьер|трейлер/i.test(text)) { score += 5; reasons.push("Анонс или премьера"); }
  if (/rumou?r|leak|insider|слух|утечк|инсайдер|не подтвержд/i.test(text)) { score -= 40; reasons.push("Есть неподтверждённые сведения"); }
  if (/giveaway|sponsored|promo code|розыгрыш|промокод|реклама|erid:/i.test(text)) { score -= 60; reasons.push("Реклама или розыгрыш"); }
  if(source.id!=="topic-search"&&!isAnimeStory(title,excerpt,source)){score=0;reasons.push("Вне аниме-тематики");}
  return { score: Math.max(0, Math.min(99, Math.round(score))), reason: reasons.join(" · ") || "Тематическая новость" };
}
export function parseFeed(xml: string, source: Source, now = Date.now()): Candidate[] {
  const blocks = source.kind === "telegram" ? xml.split(/(?=<div class="tgme_widget_message_wrap)/).filter(block=>block.startsWith('<div class="tgme_widget_message_wrap')) : xml.match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>|<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) || [];
  const results: Candidate[] = [];
  for (const block of blocks.slice(0, 60)) {
    let title: string, excerpt: string, rawUrl: string, date: string;
    if (source.kind === "telegram") {
      const text = block.match(/<div class="tgme_widget_message_text[^\"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1] || "";
      excerpt = plain(text).replace(/Поддержи StopGame[\s\S]*$/i, "").slice(0, 1600);
      title = excerpt.split(/\n|(?<=[.!?])\s/)[0].slice(0, 220);
      rawUrl = `https://t.me/${block.match(/data-post="([^"]+)"/)?.[1] || ""}`;
      date = block.match(/<time[^>]*datetime="([^"]+)"/)?.[1] || "";
    } else {
      title = plain(tag(block, "title")).slice(0, 250);
      excerpt = plain(tag(block, "description") || tag(block, "summary") || tag(block, "content:encoded") || tag(block, "content")).slice(0, 1600);
      rawUrl = plain(tag(block, "link")) || block.match(/<link[^>]*href=['"]([^'"]+)['"]/)?.[1] || "";
      date = plain(tag(block, "pubDate") || tag(block, "published") || tag(block, "updated") || tag(block, "dc:date"));
    }
    const url = canonicalUrl(rawUrl), timestamp = Date.parse(date);
    if (!url || !title || title.length < 15 || !Number.isFinite(timestamp) || (source.id!=="topic-search"&&!isAnimeStory(title,excerpt,source)) || !freshEnough(title,excerpt,date,now)) continue;
    const publishedAt = new Date(timestamp).toISOString();
    results.push({ title, excerpt, url, publishedAt, topic: source.topic, sourceId: source.id, ...grade(title, excerpt, source, publishedAt, now) });
  }
  return results;
}
