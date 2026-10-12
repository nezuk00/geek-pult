import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
export const settings = sqliteTable("settings", { key: text("key").primaryKey(), value: text("value").notNull() });
export const sources = sqliteTable("sources", {
  id: text("id").primaryKey(), enabled: integer("enabled").notNull().default(1),
  checkedAt: text("checked_at"), error: text("error"), count: integer("count").notNull().default(0),
});
export const stories = sqliteTable("stories", {
  id: text("id").primaryKey(), url: text("url").notNull(), title: text("title").notNull(),
  excerpt: text("excerpt").notNull(), sourceId: text("source_id").notNull(), topic: text("topic").notNull(),
  publishedAt: text("published_at").notNull(), collectedAt: text("collected_at").notNull(),
  score: integer("score").notNull(), reason: text("reason").notNull(),
  status: text("status").notNull().default("new"), draft: text("draft").notNull().default(""),
  sentAt: text("sent_at"), messageId: text("message_id"), review: text("review"),
  publicationUrl: text("publication_url"), imageUrl: text("image_url"), imageSourceUrl: text("image_source_url"),
  imageNote: text("image_note"), imageCredit: text("image_credit"),
}, t => [uniqueIndex("idx_stories_url").on(t.url), index("idx_stories_status_date").on(t.status, t.publishedAt)]);
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(), startedAt: text("started_at").notNull(), finishedAt: text("finished_at"),
  status: text("status").notNull(), collected: integer("collected").notNull().default(0), message: text("message").notNull(),
}, t => [index("idx_runs_started").on(t.startedAt)]);
