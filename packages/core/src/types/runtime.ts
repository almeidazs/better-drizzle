import type { AnyColumn, SQL, Table } from 'drizzle-orm';
import type { extractTablesRelationalConfig } from 'drizzle-orm/relations';

import type {
	AnySchema,
	BetterClientOptions,
	BetterMeta,
	BetterRelationalConfig,
	BetterTableKey,
	QueryArgs,
} from '.';

export type DrizzleQueryDelegate = {
	findMany(config?: unknown): Promise<unknown[]>;
};

export type InsertBuilderLike = {
	returning?: () => Promise<Record<string, unknown>[]>;
};

export type SelectQueryLike = SQL &
	Promise<Record<string, unknown>[]> & {
		where(where?: unknown): SelectQueryLike;
	};

export type DrizzleLikeDatabase = {
	query: Record<string, DrizzleQueryDelegate>;
	insert(table: Table): {
		values(data: unknown): Promise<unknown> & InsertBuilderLike;
	};
	update(table: Table): {
		set(data: unknown): {
			where(where: unknown): Promise<unknown>;
		};
	};
	delete(table: Table): {
		where(where: unknown): Promise<unknown>;
	};
	select(selection?: Record<string, unknown>): {
		from(table: Table): SelectQueryLike;
	};
	$count?(table: Table, filters?: unknown): Promise<number>;
};

export type RuntimeSchema = ReturnType<
	typeof extractTablesRelationalConfig<Record<string, BetterRelationalConfig>>
>;

export type RuntimeContext<Schema extends AnySchema, Meta = BetterMeta> = {
	db: DrizzleLikeDatabase;
	options: BetterClientOptions<Schema, Meta>;
	fullSchema: Schema;
	relational: RuntimeSchema;
	repositories: Record<string, unknown>;
};

export type WhereCompilerContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
> = RuntimeContext<Schema, Meta> & {
	tableName: string;
	table: Table;
	tableConfig: BetterRelationalConfig;
	rootArgs?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>;
};

export type CompilableWhere = Record<string, unknown> | SQL;
export type NullableResult<T> = Promise<T | null>;
export type JoinColumns = {
	fields: AnyColumn[];
	references: AnyColumn[];
	referencedTable: Table;
};
