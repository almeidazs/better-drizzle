export interface UpdateResult {
	count: number;
}

export interface DeleteResult {
	count: number;
}

export interface PaginationResult<Columns extends Record<string, unknown>> {
	data: Columns[];
	pagination: {
		count: number;
		hasNext: boolean;
		hasPrevious: boolean;
	};
}

export enum PaginationType {
	Cursor = 1,
	Offset,
}

export interface BasePaginationOptions<
	Columns extends Record<string, unknown>,
	Type extends PaginationType = PaginationType.Offset,
> {
	type?: Type;
	limit?: number;
	orderBy?: OrderBy<Columns>;
}

export type OffsetPaginationOptions<Columns extends Record<string, unknown>> =
	BasePaginationOptions<Columns>;

export interface CursorPaginationOptions<
	Columns extends Record<string, unknown>,
> extends BasePaginationOptions<Columns, PaginationType.Cursor> {
	after?: unknown;
	before?: unknown;
}

export type PaginationOptions<Columns extends Record<string, unknown>> =
	| OffsetPaginationOptions<Columns>
	| CursorPaginationOptions<Columns>;

export type OrderBy<Columns extends Record<string, unknown>> = Partial<
	Record<keyof Columns, OrderType>
>;

export enum OrderType {
	Asc = 'asc',
	Desc = 'desc',
}
