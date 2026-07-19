type AstNode = {
	type: string;
	[key: string]: unknown;
};

type BetterOperation =
	| 'cursor'
	| 'delete'
	| 'deleteMany'
	| 'findMany'
	| 'paginate'
	| 'update'
	| 'updateMany';

type DelegateCall = {
	args: AstNode[];
	kind: 'delegate';
	node: AstNode;
	operation: BetterOperation;
	query: AstNode | null;
	viaWithoutPlugins: boolean;
};

type RawCall = {
	action: '$executeRaw' | '$raw' | '$rawUnsafe';
	args: AstNode[];
	kind: 'raw';
	node: AstNode;
	options: AstNode | null;
	queryText: string | null;
};

type PluginBypassCall = {
	kind: 'plugin-bypass';
	node: AstNode;
};

export type BetterCall = DelegateCall | RawCall | PluginBypassCall;

const DELEGATE_OPERATIONS = new Set<BetterOperation>([
	'cursor',
	'delete',
	'deleteMany',
	'findMany',
	'paginate',
	'update',
	'updateMany',
]);

const RAW_ACTIONS = new Set(['$executeRaw', '$raw', '$rawUnsafe']);

const QUERY_KEYS = new Set([
	'after',
	'before',
	'comment',
	'data',
	'deleted',
	'first',
	'include',
	'last',
	'limit',
	'lock',
	'meta',
	'mode',
	'orderBy',
	'page',
	'perPage',
	'reason',
	'select',
	'skipDuplicates',
	'system',
	'take',
	'timeoutMs',
	'update',
	'where',
	'withSensitive',
]);

const MUTATION_VERBS = [
	'alter',
	'create',
	'delete',
	'drop',
	'insert',
	'replace',
	'truncate',
	'update',
];

const TS_WRAPPER_TYPES = new Set([
	'ChainExpression',
	'TSAsExpression',
	'TSSatisfiesExpression',
	'TSNonNullExpression',
	'TSTypeAssertion',
]);

export const asNode = (value: unknown): AstNode | null =>
	value && typeof value === 'object' && 'type' in value
		? (value as AstNode)
		: null;

export const unwrapExpression = (value: unknown): AstNode | null => {
	let node = asNode(value);
	while (node && TS_WRAPPER_TYPES.has(node.type)) {
		const expression = asNode(node.expression);
		if (!expression) break;
		node = expression;
	}
	return node;
};

export const isObjectExpression = (value: unknown): value is AstNode =>
	unwrapExpression(value)?.type === 'ObjectExpression';

export const isArrayExpression = (value: unknown): value is AstNode =>
	unwrapExpression(value)?.type === 'ArrayExpression';

export const getPropertyName = (value: unknown): string | null => {
	const node = unwrapExpression(value);
	if (!node) return null;
	if (node.type === 'Identifier' && typeof node.name === 'string')
		return node.name;
	if (node.type === 'Literal' && typeof node.value === 'string')
		return node.value;
	return null;
};

export const getMemberPropertyName = (value: unknown): string | null => {
	const node = unwrapExpression(value);
	if (node?.type !== 'MemberExpression') return null;
	if (node.computed) return getPropertyName(node.property);
	return getPropertyName(node.property);
};

export const getCallArguments = (value: unknown): AstNode[] => {
	const node = unwrapExpression(value);
	if (node?.type !== 'CallExpression' || !Array.isArray(node.arguments))
		return [];
	return node.arguments
		.map((argument) => unwrapExpression(argument))
		.filter(Boolean) as AstNode[];
};

export const getFirstArgumentObject = (value: unknown) => {
	const [first] = getCallArguments(value);
	return isObjectExpression(first) ? first : null;
};

export const getObjectProperty = (
	objectNode: unknown,
	name: string,
): AstNode | null => {
	const node = unwrapExpression(objectNode);
	if (node?.type !== 'ObjectExpression' || !Array.isArray(node.properties))
		return null;

	for (const property of node.properties) {
		const candidate = asNode(property);
		if (candidate?.type !== 'Property') continue;
		if (candidate.kind !== 'init') continue;
		if (getPropertyName(candidate.key) !== name) continue;
		return unwrapExpression(candidate.value);
	}

	return null;
};

export const getBooleanProperty = (objectNode: unknown, name: string) => {
	const node = getObjectProperty(objectNode, name);
	return node?.type === 'Literal' && typeof node.value === 'boolean'
		? node.value
		: undefined;
};

export const getNumberProperty = (objectNode: unknown, name: string) => {
	const node = getObjectProperty(objectNode, name);
	return node?.type === 'Literal' && typeof node.value === 'number'
		? node.value
		: undefined;
};

export const getStringProperty = (objectNode: unknown, name: string) => {
	const node = getObjectProperty(objectNode, name);
	return node?.type === 'Literal' && typeof node.value === 'string'
		? node.value
		: undefined;
};

export const getStaticString = (value: unknown): string | null => {
	const node = unwrapExpression(value);
	if (!node) return null;
	if (node.type === 'Literal' && typeof node.value === 'string')
		return node.value;
	if (node.type !== 'TemplateLiteral') return null;
	if (!Array.isArray(node.expressions) || node.expressions.length > 0)
		return null;
	if (!Array.isArray(node.quasis) || node.quasis.length !== 1) return null;
	const [quasi] = node.quasis;
	const raw =
		quasi &&
		typeof quasi === 'object' &&
		'value' in quasi &&
		quasi.value &&
		typeof quasi.value === 'object' &&
		'cooked' in quasi.value &&
		typeof quasi.value.cooked === 'string'
			? quasi.value.cooked
			: null;
	return raw;
};

export const hasOwnProperties = (value: unknown) => {
	const node = unwrapExpression(value);
	return Boolean(
		node &&
			node.type === 'ObjectExpression' &&
			Array.isArray(node.properties) &&
			node.properties.some(
				(property) => asNode(property)?.type === 'Property',
			),
	);
};

export const isEmptyWhere = (
	whereNode: unknown,
	treatUndefinedAsEmpty: boolean,
	treatEmptyAndOrAsEmpty: boolean,
) => {
	if (!whereNode) return treatUndefinedAsEmpty;
	const node = unwrapExpression(whereNode);
	if (node?.type !== 'ObjectExpression') return false;
	if (!hasOwnProperties(node)) return true;
	if (!treatEmptyAndOrAsEmpty) return false;

	const andNode = getObjectProperty(node, 'AND');
	if (
		andNode?.type === 'ArrayExpression' &&
		Array.isArray(andNode.elements) &&
		andNode.elements.length === 0
	)
		return true;
	const orNode = getObjectProperty(node, 'OR');
	if (
		orNode?.type === 'ArrayExpression' &&
		Array.isArray(orNode.elements) &&
		orNode.elements.length === 0
	)
		return true;
	return false;
};

export const getLimit = (
	queryNode: AstNode | null,
	operation?: BetterOperation,
) => {
	const limit = getNumberProperty(queryNode, 'limit');
	if (limit !== undefined) return limit;
	const take = getNumberProperty(queryNode, 'take');
	if (take !== undefined) return take;
	if (operation === 'paginate')
		return getNumberProperty(queryNode, 'perPage');
	if (operation === 'cursor')
		return (
			getNumberProperty(queryNode, 'first') ??
			getNumberProperty(queryNode, 'last')
		);
	return undefined;
};

export const hasOrderBy = (queryNode: AstNode | null) => {
	const orderBy = getObjectProperty(queryNode, 'orderBy');
	if (!orderBy) return false;
	if (orderBy.type === 'ArrayExpression')
		return Array.isArray(orderBy.elements) && orderBy.elements.length > 0;
	return true;
};

export const getOrderByColumns = (queryNode: AstNode | null): string[] => {
	const orderBy = getObjectProperty(queryNode, 'orderBy');
	if (!orderBy) return [];
	const values =
		orderBy.type === 'ArrayExpression' && Array.isArray(orderBy.elements)
			? orderBy.elements
					.map((item) => unwrapExpression(item))
					.filter(Boolean)
			: [orderBy];
	const columns: string[] = [];

	for (const value of values) {
		if (
			value?.type !== 'ObjectExpression' ||
			!Array.isArray(value.properties)
		)
			continue;
		for (const property of value.properties) {
			const candidate = asNode(property);
			if (candidate?.type !== 'Property') continue;
			const key = getPropertyName(candidate.key);
			if (!key || key === 'asc' || key === 'desc') continue;
			columns.push(key);
		}
	}

	return columns;
};

export const getIncludeStats = (
	includeNode: unknown,
	depth = 1,
): { depth: number; relations: number } => {
	const node = unwrapExpression(includeNode);
	if (node?.type !== 'ObjectExpression' || !Array.isArray(node.properties))
		return { depth: 0, relations: 0 };

	let maxDepth = depth;
	let relations = 0;

	for (const property of node.properties) {
		const candidate = asNode(property);
		if (candidate?.type !== 'Property') continue;
		const value = unwrapExpression(candidate.value);
		if (!value) continue;
		if (
			value.type === 'Literal' &&
			(value.value === false || value.value === null)
		)
			continue;
		relations += 1;
		if (value.type !== 'ObjectExpression') continue;
		const nested =
			getObjectProperty(value, 'with') ??
			getObjectProperty(value, 'include');
		const child = getIncludeStats(nested, depth + 1);
		if (child.depth > maxDepth) maxDepth = child.depth;
		relations += child.relations;
	}

	return { depth: maxDepth, relations };
};

export const hasSensitiveSelectField = (
	selectNode: unknown,
	names: readonly string[],
) => {
	const node = unwrapExpression(selectNode);
	if (node?.type !== 'ObjectExpression' || !Array.isArray(node.properties))
		return null;

	for (const property of node.properties) {
		const candidate = asNode(property);
		if (candidate?.type !== 'Property') continue;
		const key = getPropertyName(candidate.key);
		const value = unwrapExpression(candidate.value);
		if (!key || !value) continue;
		if (!names.includes(key)) continue;
		if (value.type === 'Literal' && value.value === true) return key;
	}

	return null;
};

export const isMutationQuery = (
	queryText: string,
	allow?: readonly string[],
) => {
	const trimmed = queryText.trim().toLowerCase();
	if (allow?.some((item) => trimmed.startsWith(item.toLowerCase())))
		return false;
	const first = trimmed
		.replace(/^\/\*[\s\S]*?\*\//, '')
		.trim()
		.split(/\s+/, 1)[0];
	return first ? MUTATION_VERBS.includes(first) : false;
};

const looksLikeQueryObject = (queryNode: AstNode | null) => {
	if (
		queryNode?.type !== 'ObjectExpression' ||
		!Array.isArray(queryNode.properties)
	)
		return false;
	if (queryNode.properties.length === 0) return true;
	return queryNode.properties.some((property) => {
		const candidate = asNode(property);
		return (
			candidate?.type === 'Property' &&
			QUERY_KEYS.has(getPropertyName(candidate.key) ?? '')
		);
	});
};

const parseDelegateBase = (
	value: unknown,
): { recognized: boolean; viaWithoutPlugins: boolean } => {
	const node = unwrapExpression(value);
	if (!node) return { recognized: false, viaWithoutPlugins: false };

	if (node.type === 'CallExpression') {
		const callee = unwrapExpression(node.callee);
		const prop = getMemberPropertyName(callee);
		if (prop === 'repository')
			return { recognized: true, viaWithoutPlugins: false };
		if (prop === '$withState')
			return parseDelegateBase(asNode(callee)?.object);
		if (prop === '$withoutPlugins') {
			const result = parseDelegateBase(asNode(callee)?.object);
			return {
				recognized: result.recognized,
				viaWithoutPlugins: result.recognized,
			};
		}
		return { recognized: false, viaWithoutPlugins: false };
	}

	if (node.type !== 'MemberExpression')
		return { recognized: false, viaWithoutPlugins: false };
	const propertyName = getMemberPropertyName(node);
	if (!propertyName || propertyName.startsWith('$'))
		return { recognized: false, viaWithoutPlugins: false };
	return { recognized: true, viaWithoutPlugins: false };
};

export const parseBetterCall = (value: unknown): BetterCall | null => {
	const node = unwrapExpression(value);
	if (node?.type !== 'CallExpression') return null;
	const callee = unwrapExpression(node.callee);
	const propertyName = getMemberPropertyName(callee);
	if (!propertyName) return null;

	if (propertyName === '$withoutPlugins')
		return {
			kind: 'plugin-bypass',
			node,
		};

	if (RAW_ACTIONS.has(propertyName)) {
		const args = getCallArguments(node);
		return {
			action: propertyName as RawCall['action'],
			args,
			kind: 'raw',
			node,
			options: isObjectExpression(args.at(-1))
				? (args.at(-1) as AstNode)
				: null,
			queryText: getStaticString(args[0]),
		};
	}

	if (!DELEGATE_OPERATIONS.has(propertyName as BetterOperation)) return null;
	const base = parseDelegateBase(asNode(callee)?.object);
	const args = getCallArguments(node);
	const query = getFirstArgumentObject(node);
	if (!base.recognized || (args.length > 0 && !looksLikeQueryObject(query)))
		return null;

	return {
		args,
		kind: 'delegate',
		node,
		operation: propertyName as BetterOperation,
		query,
		viaWithoutPlugins: base.viaWithoutPlugins,
	};
};
