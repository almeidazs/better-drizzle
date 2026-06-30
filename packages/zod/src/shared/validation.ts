import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';
import type { ZodError, ZodTypeAny } from 'zod';

import type { ZodPluginValidateOptions } from '../types';

export const DEFAULT_VALIDATE = {
	count: false,
	create: true,
	createMany: true,
	cursor: false,
	delete: false,
	deleteMany: false,
	exists: false,
	findFirst: false,
	findMany: false,
	findOne: false,
	findUnique: false,
	paginate: false,
	query: false,
	result: true,
	update: true,
	updateEach: true,
	updateMany: true,
	upsert: true,
	upsertMany: true,
} satisfies Record<string, boolean>;

export const shouldValidate = (
	options: ZodPluginValidateOptions | undefined,
	kind: keyof typeof DEFAULT_VALIDATE | 'query' | 'result',
	flag: boolean | undefined,
) => {
	if (flag === false) return false;
	if (flag === true) return true;

	return options?.[kind] ?? DEFAULT_VALIDATE[kind];
};

const formatZodError = (error: ZodError) =>
	error.issues.map((issue) => ({
		code: issue.code,
		message: issue.message,
		path: issue.path.join('.'),
	}));

export const parseOrThrow = (
	schema: ZodTypeAny,
	value: unknown,
	context: {
		operation: string;
		table: string;
	},
) => {
	const result = schema.safeParse(value);
	if (result.success) return result.data;

	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.OperationError,
		details: {
			issues: formatZodError(result.error),
			pluginId: '@better-drizzle/zod',
		},
		message: `Zod validation failed for ${context.operation} on "${context.table}".`,
		table: context.table,
	});
};

export const stripUnknownColumns = (
	value: unknown,
	columns: Record<string, unknown>,
): unknown => {
	if (Array.isArray(value))
		return value.map((entry) => stripUnknownColumns(entry, columns));

	if (!value || typeof value !== 'object') return value;

	const next = Object.create(null) as Record<string, unknown>;

	for (const [key, entry] of Object.entries(value))
		if (key in columns) next[key] = entry;

	return next;
};
