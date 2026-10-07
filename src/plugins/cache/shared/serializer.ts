import { createHash } from 'node:crypto';

import { Placeholder } from 'drizzle-orm';

import type { CacheSerializer } from '../types';

const TAG = '$bd';

type Tagged = { [TAG]: string; v: unknown };

const NodeBuffer = (
	globalThis as {
		Buffer?: {
			from(value: Uint8Array | string, encoding?: string): Uint8Array;
			isBuffer(value: unknown): boolean;
		};
	}
).Buffer;

const toBase64 = (bytes: Uint8Array) => {
	if (NodeBuffer)
		return (
			NodeBuffer.from(bytes) as Uint8Array & {
				toString(encoding: string): string;
			}
		).toString('base64');
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
};

const fromBase64 = (value: string, buffer: boolean) => {
	if (NodeBuffer) {
		const bytes = NodeBuffer.from(value, 'base64');
		return buffer ? bytes : new Uint8Array(bytes);
	}
	return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
};

const isPlainObject = (value: object) => {
	const proto = Object.getPrototypeOf(value);
	return proto === Object.prototype || proto === null;
};

function replacer(this: Record<string, unknown>, key: string, value: unknown) {
	const raw = this[key];
	if (raw instanceof Date) {
		const time = raw.getTime();
		return { [TAG]: 'd', v: Number.isNaN(time) ? null : time };
	}
	if (typeof raw === 'bigint') return { [TAG]: 'n', v: raw.toString() };
	if (raw instanceof Uint8Array)
		return {
			[TAG]: NodeBuffer?.isBuffer(raw) ? 'b' : 'u',
			v: toBase64(raw),
		};
	if (
		raw === undefined ||
		typeof raw === 'function' ||
		typeof raw === 'symbol' ||
		(typeof raw === 'number' &&
			(!Number.isFinite(raw) || Object.is(raw, -0)))
	)
		throw new UncacheableValueError(typeof raw);
	if (typeof raw === 'object' && raw !== null && !Array.isArray(raw)) {
		if (
			!isPlainObject(raw) ||
			typeof (raw as Record<string, unknown>).toJSON === 'function'
		)
			throw new UncacheableValueError(raw.constructor?.name ?? 'object');
	}
	// Escapes user objects that happen to use the tag key.
	if (
		typeof raw === 'object' &&
		raw !== null &&
		TAG in raw &&
		!Array.isArray(raw)
	)
		return { [TAG]: 'o', v: Object.entries(raw) };
	return value;
}

const reviver = (_key: string, value: unknown) => {
	if (typeof value !== 'object' || value === null || !(TAG in value))
		return value;
	const { [TAG]: type, v } = value as Tagged;
	if (type === 'd') return new Date(v === null ? Number.NaN : (v as number));
	if (type === 'n') return BigInt(v as string);
	if (type === 'b' || type === 'u')
		return fromBase64(v as string, type === 'b');
	if (type === 'o') return Object.fromEntries(v as [string, unknown][]);
	return value;
};

/**
 * JSON with tags for `Date`, `bigint`, `Buffer`, and `Uint8Array`.
 * Rejects unsupported values instead of silently dropping or changing them.
 */
export const defaultSerializer: CacheSerializer = {
	deserialize: (value) =>
		value.includes(TAG) || value.includes('\\u')
			? JSON.parse(value, reviver)
			: JSON.parse(value),
	serialize: (value) => JSON.stringify(value, replacer),
};

/** Thrown by {@link canonicalize} for values it cannot hash reliably. */
export class UncacheableValueError extends Error {}

/**
 * Stable text for hashing: object keys are sorted and `undefined`
 * properties are skipped. SQL objects, functions, and class instances
 * cannot be hashed and throw {@link UncacheableValueError}.
 */
function canonicalText(
	value: unknown,
	ancestors: object[],
	mode:
		| 'value'
		| 'query'
		| 'relations'
		| 'orderBy'
		| 'sort'
		| 'read'
		| 'where'
		| 'ordered',
): string {
	if (value === null || value === undefined) return 'null';
	switch (typeof value) {
		case 'string':
			return JSON.stringify(value);
		case 'number':
		case 'boolean':
			return String(value);
		case 'bigint':
			return `${value}n`;
		case 'object':
			break;
		default:
			throw new UncacheableValueError(typeof value);
	}
	if (value instanceof Date) return `D${value.getTime()}`;
	if (value instanceof Uint8Array) return `B${toBase64(value)}`;
	// A prepared statement param; its execution value is hashed separately.
	if (value instanceof Placeholder) return `P${JSON.stringify(value.name)}`;
	if (ancestors.includes(value))
		throw new UncacheableValueError('cyclic value');
	ancestors.push(value);
	if (Array.isArray(value)) {
		let text = '[';
		for (let index = 0; index < value.length; index++)
			text +=
				(index ? ',' : '') +
				canonicalText(
					value[index],
					ancestors,
					mode === 'read' ? (index === 2 ? 'query' : 'value') : mode,
				);
		ancestors.pop();
		return `${text}]`;
	}
	if (!isPlainObject(value))
		throw new UncacheableValueError(value.constructor?.name ?? 'object');

	const record = value as Record<string, unknown>;
	let text = '{';
	let first = true;
	const keys = Object.keys(record);
	// orderBy field maps keep priority order; a `{ direction, nulls }` sort
	// config does not, so its keys are sorted.
	if (
		mode === 'sort'
			? keys.length === 2 &&
				'direction' in record &&
				(record.nulls === 'first' || record.nulls === 'last')
			: mode !== 'orderBy' && mode !== 'ordered'
	)
		keys.sort();
	for (const key of keys) {
		if (record[key] === undefined) continue;
		let childMode: typeof mode = 'value';
		if (mode === 'ordered' || mode === 'where') childMode = 'ordered';
		else if (mode === 'orderBy' || mode === 'sort') childMode = 'sort';
		else if (mode === 'relations') childMode = 'query';
		else if (mode === 'query') {
			if (key === 'where') childMode = 'where';
			else if (key === 'orderBy') childMode = 'orderBy';
			else if (key === 'include' || key === 'select')
				childMode = 'relations';
		}
		text += `${first ? '' : ','}${JSON.stringify(key)}:${canonicalText(record[key], ancestors, childMode)}`;
		first = false;
	}
	ancestors.pop();
	return `${text}}`;
}

export const canonicalize = (value: unknown): string =>
	canonicalText(value, [], 'value');

/** Preserve SQL ordering priority while sorting unordered query properties. */
export const canonicalizeQueryArgs = (value: unknown): string =>
	canonicalText(value, [], 'query');

/** Cache identity tuple: model, operation, query arguments, tags and vary values. */
export const canonicalizeRead = (value: readonly unknown[]): string =>
	canonicalText(value, [], 'read');

export const hash = (value: string) =>
	createHash('sha256').update(value).digest('base64url');

export const byteLength = (value: string) =>
	NodeBuffer
		? (
				NodeBuffer as unknown as { byteLength(value: string): number }
			).byteLength(value)
		: new TextEncoder().encode(value).length;
