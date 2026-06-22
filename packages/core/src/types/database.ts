/**
 * Result returned by update operations that report the number of affected rows.
 */
export interface UpdateResult {
	/** Number of rows that were modified. */
	count: number;
}

/**
 * Result returned by delete operations that report the number of affected rows.
 */
export interface DeleteResult {
	/** Number of rows that were deleted. */
	count: number;
}

/**
 * Paginated result wrapping a list of rows alongside navigation metadata.
 *
 * @typeParam Columns - The shape of each row in the result set.
 */
export interface PaginationResult<Columns extends Record<string, unknown>> {
	/** The page of data. */
	data: Columns[];
	/** Pagination metadata. */
	pagination: {
		/** Total number of matching rows across all pages. */
		count: number;
		/** Whether a subsequent page exists. */
		hasNext: boolean;
		/** Whether a preceding page exists. */
		hasPrevious: boolean;
	};
}

/**
 * Strategy used for pagination.
 */
export enum PaginationType {
	/** Cursor-based pagination using opaque boundary tokens. */
	Cursor = 1,
	/** Traditional offset-based (skip / limit) pagination. */
	Offset,
}

/**
 * Base options shared by all pagination strategies.
 *
 * @typeParam Columns - The shape of each row in the result set.
 * @typeParam Type - The pagination type. Defaults to {@link PaginationType.Offset}.
 */
export interface BasePaginationOptions<
	Columns extends Record<string, unknown>,
	Type extends PaginationType = PaginationType.Offset,
> {
	/** The pagination strategy to use. */
	type?: Type;
	/** Maximum number of rows to return per page. */
	limit?: number;
	/** Sort order for the result set. */
	orderBy?: OrderBy<Columns>;
}

/**
 * Options for offset-based (skip / limit) pagination.
 *
 * @typeParam Columns - The shape of each row in the result set.
 */
export type OffsetPaginationOptions<Columns extends Record<string, unknown>> =
	BasePaginationOptions<Columns>;

/**
 * Options for cursor-based pagination.
 *
 * @typeParam Columns - The shape of each row in the result set.
 */
export interface CursorPaginationOptions<
	Columns extends Record<string, unknown>,
> extends BasePaginationOptions<Columns, PaginationType.Cursor> {
	/** Cursor token pointing after which rows should be returned. */
	after?: unknown;
	/** Cursor token pointing before which rows should be returned. */
	before?: unknown;
}

/**
 * Union of all supported pagination option shapes.
 *
 * @typeParam Columns - The shape of each row in the result set.
 */
export type PaginationOptions<Columns extends Record<string, unknown>> =
	| OffsetPaginationOptions<Columns>
	| CursorPaginationOptions<Columns>;

/**
 * Sort specification for a result set. Each key is a column name and the value
 * indicates the sort direction.
 *
 * @typeParam Columns - The shape of each row in the result set.
 */
export type OrderBy<Columns extends Record<string, unknown>> = Partial<
	Record<keyof Columns, OrderType>
>;

/**
 * Sort direction values.
 */
export enum OrderType {
	/** Ascending order. */
	Asc = 'asc',
	/** Descending order. */
	Desc = 'desc',
}
