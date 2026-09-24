// Schema behind the docs code samples. Twoslash type-checks every `ts` block
// against it, so hovering `client`, `users`, `posts`, ... shows real types.
import { relations } from "drizzle-orm";
import {
	jsonb,
	integer as pgInteger,
	pgTable,
	text as pgText,
} from "drizzle-orm/pg-core";
import {
	integer,
	primaryKey,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
	id: integer("id").primaryKey(),
	email: text("email").notNull().unique(),
	name: text("name").notNull(),
	age: integer("age"),
	city: text("city"),
	active: integer("active", { mode: "boolean" }).notNull().default(true),
	tenantId: text("tenant_id"),
	createdAt: integer("created_at", { mode: "timestamp" }),
	updatedAt: integer("updated_at", { mode: "timestamp" }),
	deletedAt: integer("deleted_at", { mode: "timestamp" }),
});

export const posts = sqliteTable("posts", {
	id: integer("id").primaryKey(),
	authorId: integer("author_id")
		.notNull()
		.references(() => users.id),
	title: text("title").notNull(),
	body: text("body"),
	score: integer("score").notNull().default(0),
	published: integer("published", { mode: "boolean" }).notNull().default(false),
	createdAt: integer("created_at", { mode: "timestamp" }),
});

export const comments = sqliteTable("comments", {
	id: integer("id").primaryKey(),
	postId: integer("post_id")
		.notNull()
		.references(() => posts.id),
	authorId: integer("author_id")
		.notNull()
		.references(() => users.id),
	body: text("body").notNull(),
	likes: integer("likes").notNull().default(0),
});

export const tags = sqliteTable("tags", {
	id: integer("id").primaryKey(),
	slug: text("slug").notNull().unique(),
});

export const postTags = sqliteTable(
	"post_tags",
	{
		postId: integer("post_id")
			.notNull()
			.references(() => posts.id),
		tagId: integer("tag_id")
			.notNull()
			.references(() => tags.id),
	},
	(table) => [primaryKey({ columns: [table.postId, table.tagId] })],
);

export type AccountSettings = {
	plan: {
		tier: "free" | "pro" | "enterprise";
		seats: number;
		trial: boolean;
	};
	notifications: {
		email: { enabled: boolean; digest: "daily" | "weekly" | "never" };
	};
	nickname: string | null;
	referrer?: string;
	tags: string[];
};

export const accounts = pgTable("accounts", {
	id: pgInteger("id").primaryKey(),
	name: pgText("name").notNull(),
	settings: jsonb("settings").$type<AccountSettings>().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
	posts: many(posts),
	comments: many(comments),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
	author: one(users, { fields: [posts.authorId], references: [users.id] }),
	comments: many(comments),
	postTags: many(postTags),
}));

export const commentsRelations = relations(comments, ({ one }) => ({
	post: one(posts, { fields: [comments.postId], references: [posts.id] }),
	author: one(users, { fields: [comments.authorId], references: [users.id] }),
}));

export const tagsRelations = relations(tags, ({ many }) => ({
	postTags: many(postTags),
}));

export const postTagsRelations = relations(postTags, ({ one }) => ({
	post: one(posts, { fields: [postTags.postId], references: [posts.id] }),
	tag: one(tags, { fields: [postTags.tagId], references: [tags.id] }),
}));

export const schema = {
	users,
	posts,
	comments,
	tags,
	postTags,
	accounts,
	usersRelations,
	postsRelations,
	commentsRelations,
	tagsRelations,
	postTagsRelations,
};
