import { BetterDrizzleError, BetterDrizzleErrorCode } from 'better-drizzle';

import type { AtaPluginValidateOptions } from '../types';

/**
 * Which operations are validated unless told otherwise.
 *
 * The same split the zod plugin makes: what you write is checked, what you read
 * is not. A payload comes from outside and is worth refusing early; a query
 * argument is usually built in code the compiler already checked, so paying for
 * it on every call is not the default. `result` is on because a result that does
 * not match the schema means the schema and the database have drifted, which is
 * worth hearing about.
 */
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

export type ValidateKind = keyof typeof DEFAULT_VALIDATE;

/**
 * Whether this operation is validated. A per-call `validate` beats the plugin's
 * options, which beat the defaults above.
 */
export const shouldValidate = (
	options: AtaPluginValidateOptions | undefined,
	kind: ValidateKind | 'query' | 'result',
	flag: boolean | undefined,
): boolean => {
	if (flag !== undefined) return flag;
	const configured = options?.[kind as ValidateKind];
	if (configured !== undefined) return configured;
	return DEFAULT_VALIDATE[kind as ValidateKind] ?? false;
};

/** One thing that was wrong, in the shape the zod plugin reports. */
export type AtaIssue = {
	/** ata's stable error code, e.g. `ATA1001`. */
	code: string;
	/** A page describing that code. */
	docUrl?: string;
	message: string;
	/** Dot-joined path to the value, `''` for the root. */
	path: string;
};

type AtaError = {
	code?: string;
	docUrl?: string;
	instancePath?: string;
	message?: string;
	path?: string;
};

/**
 * A JSON Pointer becomes the dot path the zod plugin reports, so a caller
 * reading `details.issues` does not have to care which plugin produced them.
 */
const toDotPath = (pointer: string): string =>
	pointer
		.split('/')
		.slice(1)
		.map((segment) => segment.replace(/~1/g, '/').replace(/~0/g, '~'))
		.join('.');

const toIssues = (errors: readonly AtaError[] | undefined): AtaIssue[] =>
	(errors ?? []).map((error) => ({
		code: error.code ?? 'ATA0000',
		docUrl: error.docUrl,
		message: error.message ?? 'invalid value',
		path: toDotPath(error.instancePath ?? error.path ?? ''),
	}));

/** What a compiled validator has to offer this plugin. */
export type AtaValidatorLike = {
	validate(value: unknown): {
		errors?: readonly AtaError[];
		valid: boolean;
	};
};

/**
 * Validate, or throw the error the rest of Better Drizzle throws.
 *
 * Unlike the zod plugin this returns the value it was given rather than a parsed
 * one. ata validates, it does not transform: there is no coercion step to take
 * the value through, so handing back a rebuilt object would only cost an
 * allocation and lose whatever the caller put in it. Anything the plugin has to
 * change, it changes on purpose and says so.
 */
export const validateOrThrow = <Value>(
	validator: AtaValidatorLike | undefined,
	value: Value,
	context: { operation: string; table: string },
): Value => {
	if (!validator) return value;

	const result = validator.validate(value);
	if (result.valid) return value;

	throw new BetterDrizzleError({
		code: BetterDrizzleErrorCode.OperationError,
		details: {
			issues: toIssues(result.errors),
			pluginId: 'better-drizzle/ata',
		},
		message: `ata validation failed for ${context.operation} on "${context.table}".`,
		table: context.table,
	});
};

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Drop keys that are not columns of the table.
 *
 * Only used where the core expects a payload narrowed to real columns. ata
 * refuses an unknown key rather than stripping it, so this runs on values that
 * have already been accepted.
 */
export const stripUnknownColumns = (
	value: unknown,
	columns: Record<string, unknown>,
): unknown => {
	if (Array.isArray(value))
		return value.map((item) => stripUnknownColumns(item, columns));
	if (!isPlainRecord(value)) return value;

	const out: Record<string, unknown> = Object.create(null);
	for (const key of Object.keys(value))
		if (key in columns) out[key] = value[key];
	return out;
};
