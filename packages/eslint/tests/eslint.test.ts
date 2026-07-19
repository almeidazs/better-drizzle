import { describe } from 'bun:test';
import parser from '@typescript-eslint/parser';
import { RuleTester } from 'eslint';

import plugin from '../src';

const tester = new RuleTester({
	languageOptions: {
		ecmaVersion: 'latest',
		parser,
		sourceType: 'module',
	},
});

describe('@better-drizzle/eslint', () => {
	tester.run(
		'no-update-many-without-where',
		plugin.rules['no-update-many-without-where'],
		{
			invalid: [
				{
					code: `
const client = {} as any;
client.users.updateMany({ data: { active: false } });
`,
					errors: [
						{ message: 'updateMany requires a where clause.' },
					],
				},
			],
			valid: [
				{
					code: `
const client = {} as any;
client.users.updateMany({ where: { id: 1 }, data: { active: false } });
`,
				},
			],
		},
	);

	tester.run('no-empty-where', plugin.rules['no-empty-where'], {
		invalid: [
			{
				code: `
const client = {} as any;
client.users.update({ where: {}, data: { active: false } });
`,
				errors: [{ message: 'The where clause is empty.' }],
			},
			{
				code: `
const client = {} as any;
client.users.update({
	where: { AND: [] },
	data: { active: false },
});
`,
				errors: [{ message: 'The where clause is empty.' }],
				options: [{ treatEmptyAndOrAsEmpty: true }],
			},
		],
		valid: [
			{
				code: `
const client = {} as any;
client.users.update({ where: { id: 1 }, data: { active: false } });
`,
			},
		],
	});

	tester.run('max-limit', plugin.rules['max-limit'], {
		invalid: [
			{
				code: `
const client = {} as any;
client.users.findMany({ limit: 20 });
`,
				errors: [
					{
						message:
							'The requested limit 20 exceeds the maximum 10.',
					},
				],
				options: [{ value: 10 }],
			},
		],
		valid: [
			{
				code: `
const client = {} as any;
client.users.findMany({ limit: 10 });
`,
				options: [{ value: 10 }],
			},
		],
	});

	tester.run(
		'require-order-by-for-pagination',
		plugin.rules['require-order-by-for-pagination'],
		{
			invalid: [
				{
					code: `
const client = {} as any;
client.users.paginate({ page: 1, perPage: 20 });
`,
					errors: [{ message: 'paginate requires orderBy.' }],
				},
			],
			valid: [
				{
					code: `
const client = {} as any;
client.users.paginate({ page: 1, perPage: 20, orderBy: { id: 'asc' } });
`,
				},
			],
		},
	);

	tester.run(
		'require-stable-order-by-for-cursor',
		plugin.rules['require-stable-order-by-for-cursor'],
		{
			invalid: [
				{
					code: `
const client = {} as any;
client.users.cursor({ first: 10, orderBy: { createdAt: 'asc' } });
`,
					errors: [
						{
							message:
								'cursor pagination requires a stable orderBy that includes the primary key.',
						},
					],
					options: [{ requirePrimaryKeyInOrderBy: true }],
				},
			],
			valid: [
				{
					code: `
const client = {} as any;
client.users.cursor({ first: 10, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
`,
					options: [{ requirePrimaryKeyInOrderBy: true }],
				},
			],
		},
	);

	tester.run('max-include-depth', plugin.rules['max-include-depth'], {
		invalid: [
			{
				code: `
const client = {} as any;
client.users.findMany({
	include: {
		posts: {
			with: {
				comments: true,
			},
		},
	},
});
`,
				errors: [{ message: 'include depth 2 exceeds the maximum 1.' }],
				options: [{ value: 1 }],
			},
		],
		valid: [
			{
				code: `
const client = {} as any;
client.users.findMany({
	include: {
		posts: true,
	},
});
`,
				options: [{ value: 1 }],
			},
		],
	});

	tester.run(
		'no-invalid-lock-combination',
		plugin.rules['no-invalid-lock-combination'],
		{
			invalid: [
				{
					code: `
const client = {} as any;
client.users.findMany({
	lock: {
		mode: 'forUpdate',
		noWait: true,
		skipLocked: true,
	},
	orderBy: { id: 'asc' },
});
`,
					errors: [
						{
							message:
								'skipLocked and noWait cannot be used together.',
						},
					],
				},
			],
			valid: [
				{
					code: `
const client = {} as any;
client.users.findMany({
	lock: {
		mode: 'forUpdate',
		skipLocked: true,
	},
	orderBy: { id: 'asc' },
	limit: 10,
});
`,
				},
			],
		},
	);

	tester.run('no-raw-unsafe', plugin.rules['no-raw-unsafe'], {
		invalid: [
			{
				code: `
const client = {} as any;
client.$rawUnsafe('select 1');
`,
				errors: [{ message: 'rawUnsafe is not allowed.' }],
			},
		],
		valid: [
			{
				code: `
const client = {} as any;
client.$raw('select 1', [], { comment: 'safe', timeoutMs: 1000 });
`,
			},
		],
	});

	tester.run('require-raw-timeout', plugin.rules['require-raw-timeout'], {
		invalid: [
			{
				code: `
const client = {} as any;
client.$rawUnsafe('select 1', [], { comment: 'audit' });
`,
				errors: [{ message: 'Raw queries require timeoutMs.' }],
			},
		],
		valid: [
			{
				code: `
const client = {} as any;
client.$rawUnsafe('select 1', [], { comment: 'audit', timeoutMs: 1000 });
`,
			},
		],
	});

	tester.run('no-raw-mutation', plugin.rules['no-raw-mutation'], {
		invalid: [
			{
				code: `
const client = {} as any;
client.$rawUnsafe('update users set active = false', [], {
	comment: 'bulk',
	timeoutMs: 1000,
});
`,
				errors: [{ message: 'Raw mutation queries are not allowed.' }],
			},
		],
		valid: [
			{
				code: `
const client = {} as any;
client.$rawUnsafe('select * from users', [], {
	comment: 'bulk',
	timeoutMs: 1000,
});
`,
			},
		],
	});

	tester.run('no-sensitive-select', plugin.rules['no-sensitive-select'], {
		invalid: [
			{
				code: `
const client = {} as any;
client.users.findMany({
	select: {
		password: true,
	},
});
`,
				errors: [
					{
						message:
							'Selecting sensitive field "password" is not allowed.',
					},
				],
			},
		],
		valid: [
			{
				code: `
const client = {} as any;
client.users.findMany({
	select: {
		password: true,
	},
	withSensitive: true,
});
`,
				options: [{ allowWithSensitive: true }],
			},
		],
	});

	tester.run(
		'require-explicit-sensitive-access-reason',
		plugin.rules['require-explicit-sensitive-access-reason'],
		{
			invalid: [
				{
					code: `
const client = {} as any;
client.users.findMany({
	select: {
		password: true,
	},
	withSensitive: true,
});
`,
					errors: [
						{
							message:
								'Sensitive access requires an explicit reason.',
						},
					],
				},
			],
			valid: [
				{
					code: `
const client = {} as any;
client.users.findMany({
	select: {
		password: true,
	},
	withSensitive: true,
	reason: 'support escalation',
});
`,
				},
			],
		},
	);

	tester.run(
		'no-plugin-bypass-without-reason',
		plugin.rules['no-plugin-bypass-without-reason'],
		{
			invalid: [
				{
					code: `
const client = {} as any;
client.users.$withoutPlugins().findMany({
	where: { id: 1 },
});
`,
					errors: [
						{
							message:
								'Using $withoutPlugins() requires a reason.',
						},
					],
				},
			],
			valid: [
				{
					code: `
const client = {} as any;
client.repository('users').$withoutPlugins().findMany({
	where: { id: 1 },
	reason: 'migration backfill',
});
`,
				},
			],
		},
	);
});
