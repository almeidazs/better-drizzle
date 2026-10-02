import type { Placeholder, SQLWrapper } from 'drizzle-orm';

import type { ExplainOptions, ExplainResult } from './explain';
import type { BetterMeta } from './query';
import type { NonNullish } from './utils';

/**
 * A named value of a prepared statement, created by `param(name)`. It is
 * Drizzle's `sql.placeholder(name)`, so the two are interchangeable.
 *
 * @typeParam Name - The param name passed to `execute()`.
 */
export type PreparedParam<
	Name extends string = string,
	Value = unknown,
> = Placeholder<Name, Value>;

type UnionToIntersection<U> = (
	U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
	? I
	: never;

type Simplify<T> = { [K in keyof T]: T[K] } & {};

type Depth = readonly unknown[];

// Walks the literal args only. `param()` already carries its value type,
// inferred from the position it is used in.
type Params<T, D extends Depth = []> = D['length'] extends 10
	? never
	: T extends PreparedParam<infer Name, infer Value>
		? string extends Name
			? never
			: { [K in Name]: Value }
		: T extends SQLWrapper | Date | ((...args: never[]) => unknown)
			? never
			: T extends readonly (infer Entry)[]
				? Params<Entry, readonly [...D, unknown]>
				: T extends object
					? {
							[K in keyof T]-?: Params<
								NonNullable<T[K]>,
								readonly [...D, unknown]
							>;
						}[keyof T]
					: never;

/**
 * Values a prepared read expects, keyed by param name. Each value type is
 * inferred from the column, operator, or pagination option the param
 * stands in for.
 */
export type PreparedParamsFor<Args> = Simplify<
	UnionToIntersection<Params<Args>>
>;

/** Per-execution options of a prepared statement. */
export interface PreparedExecuteOptions<Meta = BetterMeta> {
	/** Metadata merged over the `meta` captured at prepare time. */
	meta?: Meta;
}

type ValuesArgs<Params, Rest extends unknown[]> = {} extends Params
	? [values?: Params, ...rest: Partial<Rest>]
	: [values: Params, ...rest: Partial<Rest>];

/**
 * A read compiled once into Drizzle prepared statements. `execute()` runs
 * it with new values and returns the same result as the regular read.
 *
 * @typeParam Result - The resolved result of `execute()`.
 * @typeParam Params - The values `execute()` expects.
 * @typeParam Meta   - Custom metadata type.
 */
export interface PreparedStatement<
	Result,
	Params extends object = Record<never, never>,
	Meta = BetterMeta,
> {
	/** The name given to `.prepare(name)`; PostgreSQL uses it for the server-side statement. */
	readonly name: string | undefined;
	/**
	 * Runs the statement with `values`. Missing or unknown values reject
	 * with `PREPARED_PARAM_MISSING` / `PREPARED_PARAM_UNKNOWN`.
	 */
	execute(
		...args: ValuesArgs<Params, [options: PreparedExecuteOptions<Meta>]>
	): Promise<Result>;
	/** Returns the query plan for the statement filled with `values`. */
	explain(
		...args: ValuesArgs<Params, [options: ExplainOptions]>
	): Promise<ExplainResult>;
}

/** Result of `execute()` on a single-row statement, with `.throw()`. */
export type PreparedThrowingResult<T> = Promise<T | null> & {
	/** Throws a `BetterDrizzleError` with code `RESULT_NOT_FOUND` when the result is `null`. */
	throw(): Promise<NonNullish<T>>;
	/**
	 * Throws the error returned by the factory function when the result is `null`.
	 *
	 * @param factory - A function that returns the error to throw.
	 */
	throw(factory: () => unknown): Promise<NonNullish<T>>;
};

/** A prepared `findFirst` / `findOne` / `findUnique` statement. */
export interface PreparedSingleStatement<
	T,
	Params extends object = Record<never, never>,
	Meta = BetterMeta,
> extends Omit<PreparedStatement<T | null, Params, Meta>, 'execute'> {
	/** Runs the statement; `.throw()` rejects when no row matches. */
	execute(
		...args: ValuesArgs<Params, [options: PreparedExecuteOptions<Meta>]>
	): PreparedThrowingResult<T>;
}

/** A read result that can also be compiled with `.prepare(name?)`. */
export type PreparableResult<Statement> = {
	/**
	 * Compiles this read once into a reusable statement. Plugins and the
	 * client `beforeQuery` hook run here, once; result hooks and intercepts
	 * run on every `execute()`.
	 *
	 * @param name - Statement name. PostgreSQL uses it for the server-side
	 *   prepared statement; MySQL and SQLite ignore it.
	 */
	prepare(name?: string): Statement;
};

/**
 * Values a prepared statement expects.
 *
 * @example
 * ```ts
 * type Values = PreparedParams<typeof findUserByEmail>; // { email: string }
 * ```
 */
export type PreparedParams<Statement> = Statement extends {
	execute(...args: infer Args): unknown;
}
	? NonNullable<Args[0]>
	: never;

/**
 * Resolved result of a prepared statement.
 *
 * @example
 * ```ts
 * type User = PreparedResult<typeof findUserByEmail>;
 * ```
 */
export type PreparedResult<Statement> = Statement extends {
	execute(...args: never[]): PromiseLike<infer Result>;
}
	? Result
	: never;
