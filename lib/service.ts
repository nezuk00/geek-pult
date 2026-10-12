import { db, decrypt, encrypt, getSetting, initialize, lock, setSetting, unlock } from "./store";
import { canonicalUrl, parseFeed, sameStory, SOURCES, topicSearchSource, INTERVAL_MINUTES, FEATURE_MAX_HOURS, freshEnough, isAnimeStory, rubric } from "./news";
import { findArticleImages, loadPhoto } from "./media";
import { newsArticleUrl, photoCaption, publicHttpsUrl } from "./links";
export type Story = {id:string;url:string;title:string;excerpt:string;source_id:string;topic:string;published_at:string;collected_at:string;score:number;reason:string;status:string;draft:string;sent_at:string|null;message_id:string|null;review:string|null;publication_url:string|null;image_url:string|null;image_source_url:string|null;image_note:string|null;image_credit:string|null};
export type DraftMedia = {publicationUrl?:string;imageUrl?:string;imageSourceUrl?:string;imageNote?:string;imageCredit?:string};
export async function state() {
  await initialize();
  await db().prepare("UPDATE stories SET status='uncertain' WHERE status='sending' AND sent_at < ?").bind(new Date(Date.now() - 180000).toISOString()).run();
  const [news, sourceRows, runs, autopilot, channel, bot, next, heartbeat, channelTopic, topicSearchEnabled] = await Promise.all([
    db().prepare("SELECT * FROM (SELECT * FROM stories WHERE topic IN ('Аниме','Пользовательская') AND published_at >= ? AND status IN ('new','draft','failed') ORDER BY score DESC,published_at DESC LIMIT 300) UNION ALL SELECT * FROM (SELECT * FROM stories WHERE status IN ('sent','uncertain','sending') ORDER BY sent_at DESC LIMIT 100)").bind(new Date(Date.now()-FEATURE_MAX_HOURS*3600000).toISOString()).all<Story>(),
    db().prepare("SELECT * FROM sources").all<{id:string;enabled:number;checked_at:string|null;error:string|null;count:number}>(),
    db().prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT 12").all(),
    getSetting("autopilot", "0"), getSetting("channel"), getSetting("bot_name"), getSetting("next_publish", "0"), getSetting("heartbeat"),
    getSetting("channel_topic"), getSetting("topic_search_enabled", "0"),
  ]);
  const sourceList = channelTopic ? [...SOURCES, topicSearchSource(channelTopic)] : SOURCES;
  if (channelTopic && !sourceRows.results.some(row=>row.id==="topic-search")) await db().prepare("INSERT OR IGNORE INTO sources(id,enabled) VALUES('topic-search',?)").bind(topicSearchEnabled==="1"?1:0).run();
  const currentSourceRows = channelTopic ? [...sourceRows.results, ...(!sourceRows.results.some(row=>row.id==="topic-search")?[{id:"topic-search",enabled:topicSearchEnabled==="1"?1:0,checked_at:null,error:null,count:0}]:[])] : sourceRows.results;
  return { stories:news.results.filter(s=>["sent","uncertain","sending"].includes(s.status)||(sourceList.some(source=>source.id===s.source_id)&&freshEnough(s.title,s.excerpt,s.published_at))), sources:sourceList.map(s=>({...s,...currentSourceRows.find(row=>row.id===s.id)})), runs:runs.results,
    settings:{autopilot:autopilot==="1",channel,bot,connected:!!bot,nextPublish:Number(next),heartbeat,intervalMinutes:INTERVAL_MINUTES,channelTopic,topicSearchEnabled:topicSearchEnabled==="1"} };
}
async function boundedFetch(url: string) {
  const response = await fetch(url, { headers: { "User-Agent": "GeekPult/1.0 (personal news reader)", Accept:"application/rss+xml, application/atom+xml, text/xml, text/html" }, signal:AbortSignal.timeout(16000) });
  if (!response.ok) throw new Error(`Источник ответил HTTP ${response.status}`);
  if (!response.body) throw new Error("Пустой ответ источника");
  const reader=response.body.getReader(); const decoder=new TextDecoder(); let size=0; let body="";
  try { while(true) { const {done,value}=await reader.read(); if(done)break; size+=value.byteLength; if(size>2_000_000)throw new Error("Лента превышает допустимый размер"); body+=decoder.decode(value,{stream:true}); } return body+decoder.decode(); } finally { await reader.cancel().catch(()=>{}); }
}
export async function collect() {
  await initialize(); const lease=await lock("collect_lock"); if(!lease)throw new Error("Сбор уже идёт. Обновите ленту чуть позже.");
  const id=crypto.randomUUID(); const started=new Date().toISOString(); let count=0, failures=0;
  await db().prepare("INSERT INTO runs(id,started_at,status,message) VALUES(?,?,'running','Сбор источников')").bind(id,started).run();
  try {
    const channelTopic=(await getSetting("channel_topic")).trim();
    const sourceList=channelTopic?[...SOURCES,topicSearchSource(channelTopic)]:SOURCES;
    const enabled=(await db().prepare("SELECT id FROM sources WHERE enabled=1").all<{id:string}>()).results.map(s=>s.id).filter(id=>sourceList.some(source=>source.id===id));
    const previous=(await db().prepare("SELECT title FROM stories WHERE published_at>=?").bind(new Date(Date.now()-7*86400000).toISOString()).all<{title:string}>()).results.map(s=>s.title);
    for(let offset=0;offset<sourceList.length;offset+=3) {
      const batch=await Promise.all(sourceList.slice(offset,offset+3).filter(s=>enabled.includes(s.id)).map(async source=>{
        try { const body=await boundedFetch(source.url); if(source.kind==='telegram'&&!body.includes('tgme_widget_message_wrap'))throw new Error("Публичная лента недоступна"); if(source.kind==='rss'&&!/<rss\b|<feed\b/i.test(body))throw new Error("Вместо RSS получена страница сайта"); return {source,items:parseFeed(body,source),error:null}; }
        catch(e) { return {source,items:[],error:e instanceof Error&&e.message.startsWith("Источник")?e.message:"Не удалось прочитать ленту; повторим в следующем цикле"}; }
      }));
      for(const {source,items,error} of batch) {
        if(error)failures++;
        for(const item of items) {
          if(previous.some(t=>sameStory(t,item.title)))continue;
          const r=await db().prepare("INSERT OR IGNORE INTO stories(id,url,title,excerpt,source_id,topic,published_at,collected_at,score,reason) VALUES(?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(),item.url,item.title,item.excerpt,item.sourceId,item.topic,item.publishedAt,started,item.score,item.reason).run();
          if(r.meta.changes){count++;previous.push(item.title);}
        }
        await db().prepare("UPDATE sources SET checked_at=?,error=?,count=? WHERE id=?").bind(new Date().toISOString(),error,items.length,source.id).run();
      }
    }
    const message=`Новых: ${count}. Источников с ошибкой: ${failures}.`;
    await db().prepare("UPDATE runs SET finished_at=?,status=?,collected=?,message=? WHERE id=?").bind(new Date().toISOString(),failures===enabled.length&&enabled.length>0?"failed":failures?"partial":"success",count,message,id).run();
    return {count,failures,message};
  } catch(e) { await db().prepare("UPDATE runs SET finished_at=?,status='failed',message='Сбор прерван. Можно повторить.' WHERE id=?").bind(new Date().toISOString(),id).run(); throw e; }
  finally{await unlock("collect_lock",lease);}
}
export async function telegram<T extends Record<string,unknown>>(token:string, method:string, body:object|FormData):Promise<T> {
  let r:Response;
  try {r=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:"POST",headers:body instanceof FormData?undefined:{"Content-Type":"application/json"},body:body instanceof FormData?body:JSON.stringify(body),signal:AbortSignal.timeout(25000)});}catch{throw new Error("Связь с Telegram прервалась.");}
  const data=await r.json() as {ok:boolean;result:T;description?:string;error_code?:number};
  if(!data.ok)throw new TelegramRejection(data.error_code||r.status); return data.result;
}
class TelegramRejection extends Error { constructor(public code:number){super(`Telegram отклонил запрос (${code}). Проверьте токен, канал и права бота.`);} }
export async function connect(token:string, channel:string) {
  if(!/^(@[a-zA-Z][a-zA-Z0-9_]{4,}|-100\d{6,})$/.test(channel))throw new Error("Укажите @имя канала либо его ID вида -100…");
  if(!token){const saved=await getSetting("bot_token");if(!saved)throw new Error("Сначала укажите токен BotFather.");token=await decrypt(saved);}
  if(!/^\d{5,}:[a-zA-Z0-9_-]{20,}$/.test(token))throw new Error("Некорректный токен BotFather.");
  const lease=await lock("publish_lock",120000);if(!lease)throw new Error("Дождитесь завершения текущей публикации перед сменой канала.");
  try {
  const bot=await telegram<{id:number;username:string}>(token,"getMe",{}); const chat=await telegram<{type:string;id:number;title:string}>(token,"getChat",{chat_id:channel});
  if(chat.type!=="channel")throw new Error("Нужен Telegram-канал.");
  const member=await telegram<{status:string;can_post_messages?:boolean}>(token,"getChatMember",{chat_id:chat.id,user_id:bot.id});
  if(member.status!=="creator"&&(member.status!=="administrator"||!member.can_post_messages))throw new Error("Добавьте бота администратором канала с правом публикации.");
  const encrypted=await encrypt(token);
  await db().batch([["bot_token",encrypted],["bot_name",`@${bot.username}`],["channel",channel],["chat_id",String(chat.id)],["channel_title",chat.title],["autopilot","0"]].map(([key,value])=>db().prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,value)));
  return {bot:`@${bot.username}`,channel,title:chat.title};
  } finally {await unlock("publish_lock",lease);}
}
export async function suggestImages(id:string,publicationUrl?:string) {
  const story=await db().prepare("SELECT * FROM stories WHERE id=?").bind(id).first<Story>();if(!story)throw new Error("Новость не найдена.");
  const url=newsArticleUrl(publicationUrl||story.publication_url||story.url);if(!url)throw new Error("Сначала укажите статью новостного сайта, подтверждающую эту новость из Telegram.");
  return findArticleImages(url);
}
export async function saveDraft(id:string,text:string,review?:string,media:DraftMedia={}) {
  if(text.trim().length<30||text.length>1800)throw new Error("Текст поста должен содержать от 30 до 1800 символов.");
  const story=await db().prepare("SELECT * FROM stories WHERE id=?").bind(id).first<Story>();if(!story)throw new Error("Новость не найдена.");
  const publication=newsArticleUrl(media.publicationUrl??story.publication_url??story.url);
  if(!publication)throw new Error("Укажите подтверждающую статью новостного сайта. Ссылка на Telegram не будет опубликована.");
  const image=media.imageUrl??story.image_url??"",imageSource=media.imageSourceUrl??story.image_source_url??"";
  if(image&&!publicHttpsUrl(image))throw new Error("Некорректная ссылка на картинку.");
  if(imageSource&&!publicHttpsUrl(imageSource))throw new Error("Некорректная ссылка на страницу с картинкой.");
  const note=(media.imageNote??story.image_note??"").slice(0,700),credit=(media.imageCredit??story.image_credit??"").slice(0,180);
  photoCaption(text,publication,credit);
  const result=await db().prepare("UPDATE stories SET draft=?,status='draft',review=?,publication_url=?,image_url=?,image_source_url=?,image_note=?,image_credit=? WHERE id=? AND status IN ('new','draft','dismissed','failed')").bind(text.trim(),review?.slice(0,1500)||null,publication,image||null,imageSource||null,note||null,credit||null,id).run();
  if(!result.meta.changes)throw new Error("Новость не найдена или уже отправлена."); return {saved:true};
}
export async function publish(id:string,automatic=false) {
  const lease=await lock("publish_lock",120000); if(!lease)throw new Error("Публикация уже выполняется.");
  try {
    if(automatic && await getSetting("autopilot","0")!=="1")throw new Error("Автопилот на паузе.");
    const next=Number(await getSetting("next_publish","0"));if(Date.now()<next)throw new Error("Между постами должно пройти 2 часа.");
    const encrypted=await getSetting("bot_token"),chat_id=await getSetting("chat_id");if(!encrypted||!chat_id)throw new Error("Сначала подключите Telegram в настройках.");
    const story=await db().prepare("SELECT * FROM stories WHERE id=?").bind(id).first<Story>();
    if(!story||story.status!=="draft"||story.draft.length<30)throw new Error("Сначала сохраните готовый текст поста.");
    const channelTopic=(await getSetting("channel_topic")).trim();
    const sourceList=channelTopic?[...SOURCES,topicSearchSource(channelTopic)]:SOURCES;
    const source=sourceList.find(s=>s.id===story.source_id);
    if(!source||(story.source_id!=="topic-search"&&(story.topic!=="Аниме"||!isAnimeStory(story.title,story.excerpt,source))))throw new Error("Материал не относится к аниме-теме редакции.");
    if(!freshEnough(story.title,story.excerpt,story.published_at))throw new Error("Материал устарел: новости — до 36 часов, интервью и закулисье — до 30 дней.");
    if(rubric(story.title,story.excerpt)==="Факты и закулисье"&&Date.now()-Date.parse(story.published_at)>36*3600000&&!/из интервью|из архива|архивный факт/i.test(story.draft))throw new Error("Обозначьте давний материал словами «Из интервью» или «Из архива»; не выдавайте его за свежую новость.");
    if(automatic&&(!story.review||story.review.trim().length<20||story.score<50))throw new Error("Для автопубликации нужна проверка редактора и подходящая тема.");
    if(automatic&&!(await db().prepare("SELECT enabled FROM sources WHERE id=?").bind(story.source_id).first<{enabled:number}>())?.enabled)throw new Error("Источник отключён.");
    if(!canonicalUrl(story.url))throw new Error("Некорректная ссылка источника.");
    const caption=photoCaption(story.draft,story.publication_url||story.url,story.image_credit||"");
    if(!story.image_url||!story.image_source_url||!story.image_note||story.image_note.trim().length<12)throw new Error("Сначала выберите и проверьте тематическую картинку, укажите страницу-источник и описание.");
    const photo=await loadPhoto(story.image_url);
    const token=await decrypt(encrypted);
    if(automatic&&await getSetting("autopilot","0")!=="1")throw new Error("Автопилот на паузе.");
    const now=new Date().toISOString();
    const claimed=await db().prepare("UPDATE stories SET status='sending',sent_at=? WHERE id=? AND status='draft' AND draft=? AND image_url=? AND publication_url IS ? AND image_credit IS ?").bind(now,id,story.draft,story.image_url,story.publication_url,story.image_credit).run();
    if(!claimed.meta.changes)throw new Error("Этот пост уже обрабатывается.");
    await setSetting("next_publish",String(Date.now()+INTERVAL_MINUTES*60000));
    try {
      const form=new FormData();form.set("chat_id",chat_id);form.set("photo",photo.blob,photo.filename);form.set("caption",caption);
      const sent=await telegram<{message_id:number|string}>(token,"sendPhoto",form);
      await db().prepare("UPDATE stories SET status='sent',message_id=? WHERE id=?").bind(String(sent.message_id),id).run();
      return {sent:true,messageId:String(sent.message_id)};
    } catch(e) {
      const definite=e instanceof TelegramRejection;
      await db().prepare("UPDATE stories SET status=? WHERE id=?").bind(definite?"failed":"uncertain",id).run();
      throw new Error(definite?e.message:"Не удалось подтвердить доставку. Проверьте канал вручную: повторная отправка заблокирована.");
    }
  }finally{await unlock("publish_lock",lease);}
}
