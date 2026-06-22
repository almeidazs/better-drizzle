import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { createTestContext, type TestContext } from './setup';

let ctx: TestContext;

beforeEach(() => {
	ctx = createTestContext();
});

afterEach(() => {
	ctx.close();
});

describe('throw() - findFirst', () => {
	test('throw() returns record when found', async () => {
		const result = ctx.better.users.findFirst({ where: { id: 1 } });
		const thrown = await result.throw();
		expect(thrown).not.toBeNull();
		expect(thrown.name).toBe('Alice');
	});

	test('throw() throws when record not found', async () => {
		const result = ctx.better.users.findFirst({ where: { id: 9999 } });
		expect(result.throw()).rejects.toThrow(
			'No record found for findFirst on "users".',
		);
	});

	test('throw() with custom factory', async () => {
		const result = ctx.better.users.findFirst({ where: { id: 9999 } });
		expect(
			result.throw(() => new Error('Custom not found')),
		).rejects.toThrow('Custom not found');
	});
});

describe('throw() - findOne', () => {
	test('throw() returns record when found', async () => {
		const result = ctx.better.users.findOne({ where: { id: 2 } });
		const thrown = await result.throw();
		expect(thrown).not.toBeNull();
		expect(thrown.name).toBe('Bob');
	});

	test('throw() throws when record not found', async () => {
		const result = ctx.better.users.findOne({ where: { id: 9999 } });
		expect(result.throw()).rejects.toThrow(
			'No record found for findOne on "users".',
		);
	});

	test('throw() with custom factory', async () => {
		const result = ctx.better.users.findOne({ where: { id: 9999 } });
		expect(result.throw(() => new Error('User not found'))).rejects.toThrow(
			'User not found',
		);
	});
});

describe('throw() - findUnique', () => {
	test('throw() returns record when found', async () => {
		const result = ctx.better.users.findUnique({
			where: { email: 'alice@example.com' },
		});
		const thrown = await result.throw();
		expect(thrown).not.toBeNull();
		expect(thrown.name).toBe('Alice');
	});

	test('throw() throws when record not found', async () => {
		const result = ctx.better.users.findUnique({
			where: { email: 'nonexistent@example.com' },
		});
		expect(result.throw()).rejects.toThrow(
			'No record found for findUnique on "users".',
		);
	});

	test('throw() with custom factory', async () => {
		const result = ctx.better.users.findUnique({
			where: { email: 'nonexistent@example.com' },
		});
		expect(
			result.throw(() => new Error('Email not registered')),
		).rejects.toThrow('Email not registered');
	});
});

describe('throw() - update', () => {
	test('throw() returns updated record', async () => {
		const result = ctx.better.users.update({
			data: { name: 'Alice Updated' },
			where: { id: 1 },
		});
		const thrown = await result.throw();
		expect(thrown).not.toBeNull();
		expect(thrown.name).toBe('Alice Updated');
	});

	test('throw() throws when record not found', async () => {
		const result = ctx.better.users.update({
			data: { name: 'Ghost' },
			where: { id: 9999 },
		});
		expect(result.throw()).rejects.toThrow(
			'No record found for update on "users".',
		);
	});

	test('throw() with custom factory', async () => {
		const result = ctx.better.users.update({
			data: { name: 'Ghost' },
			where: { id: 9999 },
		});
		expect(
			result.throw(() => new Error('Update target not found')),
		).rejects.toThrow('Update target not found');
	});
});

describe('throw() - delete', () => {
	test('throw() returns deleted record', async () => {
		const result = ctx.better.users.delete({ where: { id: 5 } });
		const thrown = await result.throw();
		expect(thrown).not.toBeNull();
		expect(thrown.name).toBe('Eve');
	});

	test('throw() throws when record not found', async () => {
		const result = ctx.better.users.delete({ where: { id: 9999 } });
		expect(result.throw()).rejects.toThrow(
			'No record found for delete on "users".',
		);
	});

	test('throw() with custom factory', async () => {
		const result = ctx.better.users.delete({ where: { id: 9999 } });
		expect(
			result.throw(() => new Error('Delete target not found')),
		).rejects.toThrow('Delete target not found');
	});
});

describe('throw() - promise behavior', () => {
	test('throwing result is also awaitable as nullable', async () => {
		const result = ctx.better.users.findFirst({ where: { id: 1 } });
		const record = await result;
		expect(record).not.toBeNull();
		expect(record?.name).toBe('Alice');
	});

	test('throwing result resolves null when not found', async () => {
		const result = ctx.better.users.findFirst({ where: { id: 9999 } });
		const record = await result;
		expect(record).toBeNull();
	});

	test('throw does not affect original promise value', async () => {
		const result = ctx.better.users.findFirst({ where: { id: 1 } });
		const record1 = await result;
		const record2 = await result.throw();
		expect(record1).toEqual(record2);
	});
});
