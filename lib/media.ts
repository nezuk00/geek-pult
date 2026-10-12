import { plain } from "./news";
import { newsArticleUrl, publicHttpsUrl } from "./links";

async function fetchPublic(url: string, article = false) {
  let current = url;
  for (let hop = 0; hop < 4; hop++) {
    const safe = article ? newsArticleUrl(current) : publicHttpsUrl(current);
    if (!safe) throw new Error("Недопустимая ссылка на статью или изображение.");
    const response = await fetch(safe, {redirect:"manual",signal:AbortSignal.timeout(15000),headers:{"User-Agent":"GeekPult/1.1 (personal news reader)",Accept:article?"text/html":"image/jpeg,image/png"}});
    if ([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel(); const location=response.headers.get("location");
      if (!location) throw new Error("Пустое перенаправление."); current=new URL(location,safe).href; continue;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Не удалось загрузить ${article?"статью":"картинку"} (HTTP ${response.status}).`); }
    return {response,url:safe};
  }
  throw new Error("Слишком много перенаправлений.");
}
async function bytes(response:Response, limit:number) {
  if (!response.body) throw new Error("Пустой ответ.");
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try { while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>limit)throw new Error("Файл слишком большой.");chunks.push(next.value);} }
  finally{await reader.cancel().catch(()=>{});}
  const result=new Uint8Array(size);let offset=0;for(const chunk of chunks){result.set(chunk,offset);offset+=chunk.length;}return result;
}
export function articleImages(html:string, articleUrl:string) {
  const found:{url:string;sourceUrl:string;description:string}[]=[];
  const add=(raw:string,description:string)=>{try{const url=publicHttpsUrl(new URL(plain(raw),articleUrl).href);if(url&&!/\.(svg|gif)(?:\?|$)/i.test(url)&&!found.some(x=>x.url===url))found.push({url,sourceUrl:articleUrl,description});}catch{}};
  for(const meta of html.match(/<meta\b[^>]*>/gi)||[]) {
    const attr=Object.fromEntries([...meta.matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(m=>[m[1].toLowerCase(),m[2]]));
    if(/^(og:image(?::secure_url)?|twitter:image(?::src)?)$/i.test(attr.property||attr.name||""))add(attr.content||"","Изображение, указанное в статье");
  }
  if(!found.length) for(const tag of (html.match(/<img\b[^>]*>/gi)||[]).slice(0,60)) {
    const src=tag.match(/\b(?:src|data-src)=["']([^"']+)["']/i)?.[1];
    if(src&&!/logo|avatar|icon|pixel|tracking/i.test(src))add(src,plain(tag.match(/\balt=["']([^"']*)["']/i)?.[1]||"Иллюстрация из статьи"));
  }
  return found.slice(0,5);
}
export async function findArticleImages(url:string) {
  const {response,url:resolved}=await fetchPublic(url,true);
  const html=new TextDecoder().decode(await bytes(response,2_000_000));
  const candidates=articleImages(html,resolved);
  if(!candidates.length)throw new Error("В статье не найдена подходящая картинка. Редактор может выбрать её в поиске изображений.");
  return {publicationUrl:resolved,candidates};
}
export function imageDimensions(data:Uint8Array):{width:number;height:number;mime:string}|null {
  if(data.length>=24&&data[0]===137&&data[1]===80&&data[2]===78&&data[3]===71&&data[4]===13&&data[5]===10) {
    const view=new DataView(data.buffer,data.byteOffset,data.byteLength);return {width:view.getUint32(16),height:view.getUint32(20),mime:"image/png"};
  }
  if(data[0]!==255||data[1]!==216)return null;
  let pos=2;
  while(pos+8<data.length) {
    if(data[pos]!==255){pos++;continue;}const marker=data[pos+1];pos+=2;
    if(marker===0xd8||marker===0x01||(marker>=0xd0&&marker<=0xd7))continue;
    if(marker===0xd9||marker===0xda)break;
    const size=data[pos]*256+data[pos+1];if(size<2||pos+size>data.length)return null;
    if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return {height:data[pos+3]*256+data[pos+4],width:data[pos+5]*256+data[pos+6],mime:"image/jpeg"};
    pos+=size;
  }
  return null;
}
export async function loadPhoto(url:string) {
  const {response}=await fetchPublic(url);
  const data=await bytes(response,10_000_000); const info=imageDimensions(data);
  if(!info)throw new Error("Нужна настоящая картинка JPEG или PNG; получен другой формат.");
  if(info.width<160||info.height<100||info.width+info.height>10000||Math.max(info.width/info.height,info.height/info.width)>20)throw new Error("Размеры картинки не подходят для Telegram. Выберите другую.");
  return {blob:new Blob([data as BlobPart],{type:info.mime}),filename:info.mime==="image/png"?"news.png":"news.jpg"};
}
