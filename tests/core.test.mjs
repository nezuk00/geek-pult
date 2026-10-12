import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';
import { readFileSync, readdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const sqlite=new DatabaseSync(':memory:');
for(const name of readdirSync(new URL('../drizzle/',import.meta.url)).filter(n=>n.endsWith('.sql')).sort())sqlite.exec(readFileSync(new URL('../drizzle/'+name,import.meta.url),'utf8'));
class Statement{
  constructor(sql,args=[]){this.sql=sql;this.args=args;}
  bind(...args){return new Statement(this.sql,args);}
  async first(){return sqlite.prepare(this.sql).get(...this.args)||null;}
  async all(){return {results:sqlite.prepare(this.sql).all(...this.args)};}
  async run(){const r=sqlite.prepare(this.sql).run(...this.args);return {meta:{changes:Number(r.changes)}};}
}
globalThis.__geekEnv={DB:{prepare:sql=>new Statement(sql),batch:async statements=>{sqlite.exec('BEGIN');try{const r=await Promise.all(statements.map(s=>s.run()));sqlite.exec('COMMIT');return r;}catch(e){sqlite.exec('ROLLBACK');throw e;}}},SETTINGS_KEY:randomBytes(32).toString('base64')};
const bundle=await build({stdin:{contents:'export * from "./lib/news";export * from "./lib/service";export * from "./lib/store";export * from "./lib/links";export * from "./lib/media";',resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,plugins:[{name:'test-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:'env',namespace:'mock'}));b.onLoad({filter:/.*/,namespace:'mock'},()=>({contents:'export const env=globalThis.__geekEnv;'}));}}]});
const mod=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const fixed=new Date().toISOString(),source=mod.topicSearchSource('general news');
function rss(date=fixed,url='https://example.com/news?utm_source=feed',title='City transit expansion reaches a new milestone'){
  return `<rss><channel><item><title><![CDATA[${title}]]></title><link>${url}</link><description><![CDATA[<p>A confirmed city planning update &amp; public report.</p>]]></description><pubDate>${date}</pubDate></item></channel></rss>`;
}
const reset=()=>{sqlite.exec('DELETE FROM settings;DELETE FROM sources;DELETE FROM stories;DELETE FROM runs;');};
async function ready(){reset();await mod.initialize();await mod.setSetting('bot_token',await mod.encrypt('test-token'));await mod.setSetting('bot_name','@test_bot');await mod.setSetting('chat_id','-100123456789');await mod.setSetting('autopilot','1');await mod.setSetting('channel_topic','general news');await mod.setSetting('topic_search_enabled','1');await mod.setSetting('next_publish','0');sqlite.prepare("INSERT INTO sources(id,enabled) VALUES(?,1)").run('publisher:gematsu.com');
sqlite.prepare("INSERT INTO stories(id,url,title,excerpt,source_id,topic,published_at,collected_at,score,reason,status,draft,review,image_url,image_source_url,image_note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run('one','https://www.gematsu.com/2026/09/news','Confirmed product announcement','Source excerpt','publisher:gematsu.com','Тема канала',fixed,fixed,85,'Анонс','draft','Подтверждённая новость с подробностями. Подробности доступны по ссылке.','Проверен официальный анонс и дата.','https://images.gematsu.com/photo.png','https://www.gematsu.com/2026/09/news','Официальное изображение из статьи.');}
const png=()=>{const b=new Uint8Array(24);b.set([137,80,78,71,13,10,26,10]);const v=new DataView(b.buffer);v.setUint32(16,800);v.setUint32(20,450);return new Response(b,{headers:{'Content-Type':'image/png'}});};
const withPhoto=(telegramMock)=>async(url,init)=>String(url).startsWith('https://images.gematsu.com/')?png():telegramMock(url,init);

test('RSS/Atom parsing, canonical links and freshness gates',()=>{
const items=mod.parseFeed(rss(),source);assert.equal(items.length,1);assert.equal(items[0].url,'https://example.com/news');assert.equal(items[0].title,'City transit expansion reaches a new milestone');assert.match(items[0].excerpt,/&/);
assert.equal(mod.parseFeed(rss('invalid'),source).length,0);assert.equal(mod.parseFeed(rss(new Date(Date.now()+86400000).toISOString()),source).length,0);assert.equal(mod.parseFeed(rss(new Date(Date.now()-48*3600000).toISOString()),source).length,0);
assert.equal(mod.canonicalUrl('javascript:alert(1)'),null);assert.equal(mod.canonicalUrl('http://example.com'),null);
const atom=`<feed><entry><title>City planning office announces a new project</title><link href="https://example.com/release"/><updated>${fixed}</updated><summary>Confirmed release</summary></entry></feed>`;
assert.equal(mod.parseFeed(atom,source).length,1);
});
test('Channel theme creates a safe, encoded Google News RSS search source',()=>{
const custom=mod.topicSearchSource('urban planning: public transit');const url=new URL(custom.url);assert.equal(custom.id,'topic-search');assert.equal(custom.topic,'Тема канала');assert.equal(custom.kind,'rss');assert.equal(url.hostname,'news.google.com');assert.equal(url.searchParams.get('q'),'urban planning: public transit');
const candidate=mod.parseFeed(rss(fixed,'https://news.google.com/rss/articles/example','City transit expansion approved'),custom);assert.equal(candidate.length,1);assert.equal(candidate[0].sourceId,'topic-search');assert.equal(candidate[0].topic,'Тема канала');
});
test('Saved channel theme appears as an enabled, manageable source',async()=>{
reset();await mod.initialize();await mod.setSetting('channel_topic','public transit');await mod.setSetting('topic_search_enabled','1');const current=await mod.state();const source=current.sources.find(item=>item.id==='topic-search');assert.equal(source?.enabled,1);assert.equal(source?.name,'Поиск: public transit');assert.equal(current.settings.channelTopic,'public transit');
});
test('RSS search detects publisher names and domains',()=>{
const html=rss(fixed,'https://news.google.com/rss/articles/example','Local paper reports a transit project').replace('</item>','<source url="https://news.localpaper.example">Local Paper</source></item>');
const p=mod.parseFeed(html,source);assert.equal(p.length,1);assert.equal(p[0].sourceId,'publisher:news.localpaper.example');assert.equal(p[0].publisherName,'Local Paper');
});
test('Near duplicate titles and rumor down-ranking',()=>{
assert.equal(mod.sameStory('Nintendo reveals Metroid release date','Nintendo reveals Metroid release date!'),true);assert.equal(mod.sameStory('Nintendo reveals Metroid release date','Netflix renews Arcane season three'),false);
assert.ok(mod.grade('New trailer announced','confirmed',source,fixed).score>mod.grade('New trailer announced','unconfirmed rumor leak',source,fixed).score);
});
test('Topic collection auto-discovers publishers and respects disabled sources',async()=>{
reset();await mod.setSetting('channel_topic','general news');await mod.setSetting('topic_search_enabled','1');sqlite.prepare("INSERT INTO sources(id,enabled) VALUES('topic-search',1)").run();globalThis.fetch=async url=>{assert.match(String(url),/news.google.com\/rss\/search/);return new Response(rss().replace('</item>','<source url="https://www.localpaper.example">Local Paper</source></item>'),{headers:{'Content-Type':'application/rss+xml'}})};const first=await mod.collect();assert.equal(first.count,1);assert.equal(first.failures,0);const second=await mod.collect();assert.equal(second.count,0);const current=await mod.state();assert.equal(current.stories.length,1);assert.ok(current.sources.some(s=>s.id==='publisher:localpaper.example'&&s.enabled===1));sqlite.prepare('UPDATE sources SET enabled=0 WHERE id=?').run('publisher:localpaper.example');sqlite.exec('DELETE FROM stories');const third=await mod.collect();assert.equal(third.count,0);assert.equal((await mod.state()).sources.find(s=>s.id==='publisher:localpaper.example').enabled,0);
});
test('Settings are encrypted and secrets never enter state',async()=>{
await ready();const encrypted=await mod.getSetting('bot_token');assert.notEqual(encrypted,'test-token');assert.equal(await mod.decrypt(encrypted),'test-token');assert.ok(!JSON.stringify(await mod.state()).includes('test-token'));
});
test('Publish succeeds once; concurrent and repeated sends are rejected',async()=>{
await ready();let calls=0;globalThis.fetch=withPhoto(async(url,init)=>{calls++;assert.match(String(url),/sendPhoto$/);assert.ok(init.body instanceof FormData);assert.match(init.body.get('caption'),/Источник: https:\/\/www.gematsu.com/);assert.ok(!init.body.get('caption').includes('t.me/'));await new Promise(r=>setTimeout(r,15));return Response.json({ok:true,result:{message_id:123}})});
const results=await Promise.allSettled([mod.publish('one',true),mod.publish('one',true)]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(calls,1);assert.equal((await mod.state()).stories[0].status,'sent');await assert.rejects(mod.publish('one',true));assert.equal(calls,1);
});
test('Ambiguous delivery blocks automatic resend',async()=>{
await ready();let calls=0;globalThis.fetch=withPhoto(async()=>{calls++;throw new Error('Network timeout after send')});await assert.rejects(mod.publish('one',true),/Доставка|доставку/);assert.equal((await mod.state()).stories[0].status,'uncertain');await mod.setSetting('next_publish','0');await assert.rejects(mod.publish('one',true));assert.equal(calls,1);
});
test('Paused autopilot and missing review cannot send',async()=>{
await ready();globalThis.fetch=()=>{throw new Error('Should not send')};await mod.setSetting('autopilot','0');await assert.rejects(mod.publish('one',true),/паузе/);await mod.setSetting('autopilot','1');sqlite.exec("UPDATE stories SET review=NULL");await assert.rejects(mod.publish('one',true),/проверка/);
});
test('Invalid drafts cannot modify a sent record',async()=>{
await ready();await assert.rejects(mod.saveDraft('one','short'));sqlite.exec("UPDATE stories SET status='sent'");await assert.rejects(mod.saveDraft('one','Достаточно длинный текст для замены отправленного поста.'));assert.equal((await mod.state()).stories[0].status,'sent');
});
test('Telegram links cannot be published, including redirects encoded in text',()=>{
for(const url of ['https://t.me/channel/42','https://telegram.me/channel/42','https://t.me:443/channel/42','https://t%2Eme/channel/42','tg://resolve?domain=channel'])assert.throws(()=>mod.photoCaption('Новая игра анонсирована. Подробности: '+url,'https://www.gematsu.com/2026/news'),/Telegram/);
assert.equal(mod.newsArticleUrl('https://t.me/channel/42'),null);assert.equal(mod.newsArticleUrl('https://gematsu.com.evil.example/news'),'https://gematsu.com.evil.example/news');assert.equal(mod.newsArticleUrl('https://www.gematsu.com/2026/news?utm_source=tg'),'https://www.gematsu.com/2026/news');
assert.throws(()=>mod.photoCaption('Я'.repeat(1000),'https://www.gematsu.com/2026/news'),/1024/);
});
test('Telegram-sourced story requires a separate news website citation',async()=>{
await ready();sqlite.exec("UPDATE stories SET url='https://t.me/channel/42'");await assert.rejects(mod.saveDraft('one','Подтверждённый анонс новой игры с официальными подробностями.'),/новостного сайта/);
await mod.saveDraft('one','Подтверждённый анонс новой игры с официальными подробностями.','Проверен анонс на сайте.',{publicationUrl:'https://www.gematsu.com/2026/09/news'});assert.equal((await mod.state()).stories[0].publication_url,'https://www.gematsu.com/2026/09/news');
});
test('Article images support reordered meta attributes and relative paths',()=>{
const images=mod.articleImages('<meta content="/cover.png" property="og:image"><meta name="twitter:image" content="https://images.gematsu.com/cover.jpg">','https://www.gematsu.com/2026/news');assert.equal(images.length,2);assert.equal(images[0].url,'https://www.gematsu.com/cover.png');assert.equal(mod.articleImages('<meta property="og:image" content="http://127.0.0.1/private">','https://www.gematsu.com/news').length,0);
});
test('Invalid pictures cannot send a text-only fallback or consume the slot',async()=>{
await ready();let sends=0;globalThis.fetch=async url=>{if(String(url).includes('api.telegram.org'))sends++;return new Response('<html>Error</html>')};await assert.rejects(mod.publish('one',true),/JPEG/);assert.equal(sends,0);assert.equal((await mod.state()).stories[0].status,'draft');assert.equal(await mod.getSetting('next_publish','0'),'0');
});
test('Media selection is mandatory and blocked hosts are rejected',async()=>{
await ready();sqlite.exec('UPDATE stories SET image_note=NULL');await assert.rejects(mod.publish('one',true),/картинку/);for(const u of ['https://127.0.0.1/a.png','https://[::1]/a.png','https://a.local/a.png','https://user:pass@example.com/a.png','file:///a.png'])assert.equal(mod.publicHttpsUrl(u),null);
});

test('Topic feeds include varied subject matter and prioritize long-form stories',()=>{
 assert.equal(mod.parseFeed(rss(fixed,'https://news.google.com/rss/articles/x','City council approves new transit line'),source).length,1);
 assert.equal(mod.parseFeed(rss(fixed,'https://news.google.com/rss/articles/y','Research team reveals new solar battery'),source).length,1);
 assert.ok(mod.grade('Interview: How a city planner redesigned the riverfront','',source,fixed).score>mod.grade('New product trailer announced','',source,fixed).score);
 assert.equal(mod.parseFeed(rss(new Date(Date.now()-7*86400000).toISOString(),'https://news.google.com/rss/articles/interview','Interview with a city planner'),source).length,1);
 assert.equal(mod.parseFeed(rss(new Date(Date.now()-31*86400000).toISOString(),'https://news.google.com/rss/articles/interview','Interview with a city planner'),source).length,0);
});

test('Changing channel reuses encrypted token, checks posting rights and preserves pause',async()=>{
 await ready();const token=['123456789','abcdefghijklmnopqrstuvwxyz'].join(':');await mod.setSetting('bot_token',await mod.encrypt(token));await mod.setSetting('channel','@old_channel');
 const methods=[];globalThis.fetch=async(url,init)=>{const method=String(url).split('/').at(-1);methods.push(method);const body=JSON.parse(init.body);
 if(method==='getMe')return Response.json({ok:true,result:{id:123456789,username:'test_bot'}});
 if(method==='getChat'){assert.equal(body.chat_id,'@test_channel');return Response.json({ok:true,result:{id:-100999999999,type:'channel',title:'Test channel'}});}
 if(method==='getChatMember')return Response.json({ok:true,result:{status:'administrator',can_post_messages:true}});
 throw Error('Unexpected Telegram write');};
 await mod.connect('','@test_channel');const current=await mod.state();
 assert.deepEqual(methods,['getMe','getChat','getChatMember']);assert.equal(current.settings.channel,'@test_channel');assert.equal(current.settings.autopilot,false);assert.equal(current.settings.intervalMinutes,120);assert.ok(!JSON.stringify(current).includes(token));
});

test('Failed channel verification leaves previous destination intact',async()=>{
 await ready();await mod.setSetting('bot_token',await mod.encrypt(['123456789','abcdefghijklmnopqrstuvwxyz'].join(':')));await mod.setSetting('channel','@old_channel');
 globalThis.fetch=async url=>Response.json({ok:true,result:String(url).endsWith('/getMe')?{id:123,username:'test_bot'}:String(url).endsWith('/getChat')?{id:-100999999,type:'channel',title:'Test channel'}:{status:'member'}});
 await assert.rejects(mod.connect('','@test_channel'),/правом публикации/);assert.equal(await mod.getSetting('channel'),'@old_channel');assert.equal(await mod.getSetting('chat_id'),'-100123456789');
});

test('Two-hour cooldown applies to manual and automatic sends',async()=>{
 await ready();globalThis.fetch=withPhoto(async()=>Response.json({ok:true,result:{message_id:456}}));const before=Date.now();await mod.publish('one',true);
 assert.ok(Number(await mod.getSetting('next_publish'))>=before+120*60000);
 await assert.rejects(mod.publish('one',false),/2 часа/);await assert.rejects(mod.publish('one',true),/2 часа/);
});

test('Old game drafts and stale news cannot publish; archive interviews need explicit framing',async()=>{
 await ready();globalThis.fetch=()=>{throw Error('Must reject before network');};
 sqlite.exec("UPDATE stories SET topic='Другая тема',source_id='unlisted-source'");await assert.rejects(mod.publish('one',true),/теме канала/);
 sqlite.prepare("UPDATE stories SET topic='Тема канала',source_id='publisher:gematsu.com',published_at=?").run(new Date(Date.now()-3*86400000).toISOString());await assert.rejects(mod.publish('one',true),/устарел/);
 sqlite.exec("UPDATE stories SET title='Interview with a local reporter'");await assert.rejects(mod.publish('one',true),/Из интервью/);
});
