"use client";
import { ImageIcon, Search } from "lucide-react";
export type MediaFields = {publicationUrl:string;imageUrl:string;imageSourceUrl:string;imageNote:string;imageCredit:string};
export default function MediaEditor({value,onChange,onFind,busy}:{value:MediaFields;onChange:(value:MediaFields)=>void;onFind:()=>void;busy:boolean}) {
  const field=(key:keyof MediaFields,text:string)=>onChange({...value,[key]:text});
  return <section className="media-editor">
    <h4><ImageIcon size={17}/> Картинка и источник</h4>
    <label>Статья для ссылки в посте<input type="url" aria-label="Статья для ссылки в посте" value={value.publicationUrl} onChange={e=>field("publicationUrl",e.target.value)} placeholder="https://… — только новостной сайт"/></label>
    <button type="button" className="button wide" disabled={busy||!value.publicationUrl} onClick={onFind}><Search size={15}/> Подобрать картинку из статьи</button>
    <label>Ссылка на картинку<input type="url" aria-label="Ссылка на картинку" value={value.imageUrl} onChange={e=>field("imageUrl",e.target.value)} placeholder="Прямая ссылка на JPEG или PNG"/></label>
    <label>Страница с картинкой<input type="url" aria-label="Страница с картинкой" value={value.imageSourceUrl} onChange={e=>field("imageSourceUrl",e.target.value)} placeholder="Статья, пресс-кит или страница из поиска"/></label>
    <label>Проверка картинки<textarea aria-label="Проверка картинки" rows={2} maxLength={700} value={value.imageNote} onChange={e=>field("imageNote",e.target.value)} placeholder="Что изображено и почему подходит к новости"/></label>
    <label>Автор картинки, если требуется<input aria-label="Автор картинки" value={value.imageCredit} maxLength={180} onChange={e=>field("imageCredit",e.target.value)} placeholder="Например, название студии"/></label>
    <p className="helper small">Редактор выбирает готовое изображение из статьи или поиска. Картинки не генерируются. Страница с картинкой и заметка о проверке остаются внутри редакции.</p>
  </section>;
}
