import { describe, expect, test } from 'bun:test';

import {
	canonicalize,
	canonicalizeQueryArgs,
	defaultSerializer,
	UncacheableValueError,
} from '../../src/plugins/cache/shared/serializer';

describe('cache serializer identity', () => {
	test('preserves root and nested relation ordering priority', () => {
		const first = { id: 'asc', name: 'desc' };
		const second = { name: 'desc', id: 'asc' };
		expect(canonicalizeQueryArgs({ orderBy: first })).not.toBe(
			canonicalizeQueryArgs({ orderBy: second }),
		);
		for (const projection of ['include', 'select'])
			expect(
				canonicalizeQueryArgs({
					[projection]: {
						posts: { include: { author: { orderBy: first } } },
					},
				}),
			).not.toBe(
				canonicalizeQueryArgs({
					[projection]: {
						posts: { include: { author: { orderBy: second } } },
					},
				}),
			);
	});

	test('still canonicalizes unordered query properties and arbitrary vary values', () => {
		expect(
			canonicalizeQueryArgs({ where: { name: 'Ada', id: 1 }, limit: 2 }),
		).toBe(
			canonicalizeQueryArgs({ limit: 2, where: { id: 1, name: 'Ada' } }),
		);
		expect(canonicalize({ orderBy: { id: 1, name: 2 } })).toBe(
			canonicalize({ orderBy: { name: 2, id: 1 } }),
		);
		expect(
			canonicalizeQueryArgs({ where: { orderBy: { id: 1, name: 2 } } }),
		).not.toBe(
			canonicalizeQueryArgs({ where: { orderBy: { name: 2, id: 1 } } }),
		);
	});

	test('rejects cyclic arrays and objects while allowing reused acyclic values', () => {
		const object: Record<string, unknown> = {};
		object.self = object;
		const array: unknown[] = [];
		array.push(array);
		for (const value of [object, array]) {
			expect(() => canonicalize(value)).toThrow(UncacheableValueError);
			expect(() => canonicalizeQueryArgs(value)).toThrow(
				UncacheableValueError,
			);
		}
		const shared = { id: 1 };
		expect(canonicalize([shared, shared])).toBe('[{"id":1},{"id":1}]');
	});

	test('rejects values JSON would silently drop or change', () => {
		class CustomValue {
			value = 1;
			toJSON() {
				return this.value;
			}
		}
		for (const value of [
			undefined,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			-0,
			Symbol('value'),
			() => 1,
			new CustomValue(),
			{ toJSON: () => ({ changed: true }) },
			new Map([['value', 1]]),
			new Set([1]),
		]) {
			expect(() => defaultSerializer.serialize(value)).toThrow(
				UncacheableValueError,
			);
			expect(() => defaultSerializer.serialize({ value })).toThrow(
				UncacheableValueError,
			);
			expect(() => defaultSerializer.serialize([value])).toThrow(
				UncacheableValueError,
			);
		}
	});

	test('roundtrips invalid dates inside escaped tag objects', () => {
		const decoded = defaultSerializer.deserialize(
			defaultSerializer.serialize({ $bd: 'd', v: new Date(Number.NaN) }),
		) as { $bd: string; v: Date };
		expect(decoded.$bd).toBe('d');
		expect(decoded.v).toBeInstanceOf(Date);
		expect(Number.isNaN(decoded.v.getTime())).toBe(true);
	});
});
