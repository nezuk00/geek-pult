import { getChatGPTUser } from "../../chatgpt-auth";
import { collect, connect, publish, saveDraft, state, suggestImages } from "../../../lib/service";
import { db, getSetting, setSetting } from "../../../lib/store";
import { SOURCES } from "../../../lib/news";
export const dynamic="force-dynamic";
function json(value:unknown,status=200){return Response.json(value,{status,headers:{"Cache-Control":"no-store"}});}
export async function GET(){if(!await getChatGPTUser())return json({error:"Войдите в свою редакцию."},401);try{return json(await state());}catch{return json({error:"Не удалось загрузить редакцию. Попробуйте обновить страницу."},503);}}
export async function POST(request:Request){
  if(!await getChatGPTUser())return json({error:"Войдите в свою редакцию."},401);
  const origin=request.headers.get("origin");if(origin&&origin!==new URL(request.url).origin)return json({error:"Недопустимый источник запроса."},403);
  try{
    const raw=await request.text();if(raw.length>16000)return json({error:"Слишком большой запрос."},413);
    const body=JSON.parse(raw); const {action}=body;
    if(action==="collect")return json(await collect());
    if(action==="connect"&&typeof body.token==="string"&&typeof body.channel==="string")return json(await connect(body.token.trim(),body.channel.trim()));
    if(action==="disconnect"){await db().batch([db().prepare("DELETE FROM settings WHERE key IN ('bot_token','bot_name','channel','chat_id','channel_title')"),db().prepare("INSERT INTO settings(key,value) VALUES('autopilot','0') ON CONFLICT(key) DO UPDATE SET value='0'")]);return json({disconnected:true});}
    if(action==="theme"&&typeof body.theme==="string"){
      const theme=body.theme.trim();if(theme.length>100)throw new Error("Тема должна быть короче 100 символов.");
      if(theme&&(!/^[-\p{L}\p{N}\s.,:;!?()&+'"–—]{2,100}$/u.test(theme)||/https?:\/\/|www\./i.test(theme)))throw new Error("Укажите тему словами, без адресов сайтов.");
      await setSetting("channel_topic",theme);
      if(theme){await db().prepare("INSERT INTO sources(id,enabled) VALUES('topic-search',1) ON CONFLICT(id) DO UPDATE SET enabled=1").run();await setSetting("topic_search_enabled","1");}
      else{await db().prepare("UPDATE sources SET enabled=0 WHERE id='topic-search'").run();await setSetting("topic_search_enabled","0");}
      return json({saved:true,theme});
    }
    if(action==="source"&&typeof body.enabled==="boolean"&&(SOURCES.some(s=>s.id===body.id)||(body.id==="topic-search"&&(await getSetting("channel_topic")).trim().length>0))){
      await db().prepare("INSERT INTO sources(id,enabled) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET enabled=excluded.enabled").bind(body.id,body.enabled?1:0).run();
      if(body.id==="topic-search")await setSetting("topic_search_enabled",body.enabled?"1":"0");return json({saved:true});
    }
    if(action==="autopilot"&&typeof body.enabled==="boolean"){if(body.enabled&&!await getSetting("bot_name"))throw new Error("Сначала подключите Telegram.");await setSetting("autopilot",body.enabled?"1":"0");return json({enabled:body.enabled});}
    if(action==="heartbeat"){await setSetting("heartbeat",new Date().toISOString());return json({ok:true});}
    if(action==="images"&&typeof body.id==="string")return json(await suggestImages(body.id,typeof body.publicationUrl==="string"?body.publicationUrl:undefined));
    if(action==="draft"&&typeof body.id==="string"&&typeof body.text==="string"){
      const media:Record<string,string>={};for(const key of ["publicationUrl","imageUrl","imageSourceUrl","imageNote","imageCredit"]){if(body[key]!==undefined){if(typeof body[key]!=="string"||body[key].length>3000)return json({error:"Некорректное поле картинки или источника."},400);media[key]=body[key];}}
      return json(await saveDraft(body.id,body.text,typeof body.review==="string"?body.review:undefined,media));
    }
    if(action==="publish"&&typeof body.id==="string")return json(await publish(body.id,body.automatic===true));
    if(action==="dismiss"&&typeof body.id==="string"){await db().prepare("UPDATE stories SET status='dismissed' WHERE id=? AND status IN ('new','draft','failed')").bind(body.id).run();return json({dismissed:true});}
    return json({error:"Неизвестное действие или неверные данные."},400);
  }catch(e){return json({error:e instanceof Error&&!/D1_|SQLITE|syntax|JSON|database/i.test(e.message)?e.message:"Не удалось сохранить изменения. Попробуйте ещё раз."},400);}
}
