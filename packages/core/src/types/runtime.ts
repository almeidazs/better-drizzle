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
	findFirst?(config?: unknown): Promise<unknown | undefined>;
};

export type InsertBuilderLike = {
	returning?: () => Promise<Record<string, unknown>[]>;
	onConflictDoUpdate?: (config: {
		set: Record<string, unknown>;
		target: AnyColumn | AnyColumn[];
	}) => InsertBuilderLike & Promise<unknown>;
};

export type UpdateBuilderLike = Promise<unknown> & {
	returning?: () => Promise<Record<string, unknown>[]>;
};

export type DeleteBuilderLike = Promise<unknown> & {
	returning?: () => Promise<Record<string, unknown>[]>;
};

export type SelectQueryLike = SQL &
	Promise<Record<string, unknown>[]> & {
		innerJoin(table: Table, on: unknown): SelectQueryLike;
		leftJoin(table: Table, on: unknown): SelectQueryLike;
		limit(limit: number): SelectQueryLike;
		offset(offset: number): SelectQueryLike;
		orderBy(...values: unknown[]): SelectQueryLike;
		where(where?: unknown): SelectQueryLike;
	};

export type DrizzleLikeDatabase = {
	query: Record<string, DrizzleQueryDelegate>;
	insert(table: Table): {
		values(data: unknown): InsertBuilderLike & Promise<unknown>;
	};
	update(table: Table): {
		set(data: unknown): {
			where(where: unknown): UpdateBuilderLike;
		};
	};
	delete(table: Table): {
		where(where: unknown): DeleteBuilderLike;
	};
	select(selection?: Record<string, unknown>): {
		from(table: Table): SelectQueryLike;
	};
	$count?(table: Table, filters?: unknown): Promise<number>;
};

export type RuntimeSchema = ReturnType<
	typeof extractTablesRelationalConfig<Record<string, BetterRelationalConfig>>
>;

export type TableRuntime = {
	columns: Record<string, AnyColumn>;
	dbName: string;
	primaryKeyFields: string[];
	relations: Record<
		string,
		{
			fields: AnyColumn[];
			references: AnyColumn[];
			relation: BetterRelationalConfig['relations'][string];
			tableName: string;
		}
	>;
	relationNames: Set<string>;
	table: Table;
	tableConfig: BetterRelationalConfig;
};

export type RuntimeContext<Schema extends AnySchema, Meta = BetterMeta> = {
	db: DrizzleLikeDatabase;
	hasHooks: boolean;
	hasOnError: boolean;
	options: BetterClientOptions<Schema, Meta>;
	fullSchema: Schema;
	relational: RuntimeSchema;
	repositories: Record<string, unknown>;
	tables: Record<string, TableRuntime>;
};

export type WhereCompilerContext<
	Schema extends AnySchema,
	Meta = BetterMeta,
> = RuntimeContext<Schema, Meta> & {
	rootArgs?: QueryArgs<Schema, BetterTableKey<Schema>, Meta>;
	runtime: TableRuntime;
	tableName: string;
};

export type CompilableWhere = Record<string, unknown> | SQL;
export type NullableResult<T> = Promise<T | null>;
export type JoinColumns = {
	fields: AnyColumn[];
	references: AnyColumn[];
	referencedTable: Table;
};
