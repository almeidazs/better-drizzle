import type { AnySchema, PluginModelInfo } from 'better-drizzle';
import type { TablesRelationalConfig } from 'drizzle-orm';

import { canonicalize } from './serializer';

type Models = Readonly<Record<string, PluginModelInfo | undefined>>;
type MutableRecord = Record<string, unknown>;

/** Builds the store keys that hold dependency versions. */
export type VersionKeys = {
	all: string;
	entity(model: string, id: string): string;
	epoch(model: string): string;
	rows(model: string): string;
	tag(tag: string): string;
};

/**
 * Dependency version keys for one read. `emptyOnly[i]` marks keys that
 * only matter when the cached result is empty: a create can turn an empty
 * primary key lookup into a hit, while it cannot change an existing row.
 */
export type ReadDependencies = {
	emptyOnly: boolean[];
	keys: string[];
};

const LOGICAL = new Set(['AND', 'NOT', 'OR']);
const RELATION_FILTERS = new Set(['every', 'is', 'isNot', 'none', 'some']);
const RELATION_WRITES = new Set(['connect', 'disconnect', 'set']);
const cascadeDependencies = new WeakMap<Models, Map<string, Set<string>>>();
const cascadeColumns = new WeakMap<Models, Map<string, Set<string>>>();
const columnKeys = new WeakMap<object, string>();

/** Precompute all models reachable through incoming foreign keys. */
export const prepareCascadeDependencies = (
	models: Models,
	schema: AnySchema,
): void => {
	const edges = new Map<string, Set<string>>();
	const columns = new Map<string, Set<string>>();
	const relations = schema as TablesRelationalConfig;
	const add = (
		parent: string,
		child: string | undefined,
		references: readonly unknown[],
	) => {
		if (!child) return;
		let targets = edges.get(parent);
		if (!targets) edges.set(parent, (targets = new Set()));
		targets.add(child);
		let fields = columns.get(parent);
		if (!fields) columns.set(parent, (fields = new Set()));
		for (const key in models[parent]?.columns)
			if (references.includes(models[parent]?.columns[key]))
				fields.add(key);
	};
	for (const name in models) {
		const model = models[name];
		if (!model) continue;
		for (const key in model.columns) {
			const column = model.columns[key];
			if (column) columnKeys.set(column, key);
		}
		for (const key in model.relations) {
			const relation = model.relations[key];
			if (!relation) continue;
			const native = relations[name]?.relations[key];
			if (relation.foreignKey === 'source')
				add(relation.model, name, native?.targetColumns ?? []);
			else if (relation.foreignKey === 'target')
				add(name, relation.model, native?.sourceColumns ?? []);
			else {
				add(name, relation.through, native?.sourceColumns ?? []);
				add(
					relation.model,
					relation.through,
					native?.targetColumns ?? [],
				);
			}
		}
	}
	const dependencies = new Map<string, Set<string>>();
	for (const name in models) {
		const targets = new Set(edges.get(name));
		for (const target of targets)
			for (const child of edges.get(target) ?? []) targets.add(child);
		if (targets.size) dependencies.set(name, targets);
	}
	cascadeDependencies.set(models, dependencies);
	cascadeColumns.set(models, columns);
};

const isRecord = (value: unknown): value is MutableRecord =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

const isKeyValue = (value: unknown) =>
	typeof value === 'string' ||
	typeof value === 'number' ||
	typeof value === 'bigint';

const primaryKeyValue = (value: unknown): unknown => {
	if (isKeyValue(value)) return value;
	if (!isRecord(value)) return;
	const keys = Object.keys(value).filter((key) => value[key] !== undefined);
	if (keys.length === 1 && keys[0] === 'equals' && isKeyValue(value.equals))
		return value.equals;
};

/**
 * Returns the entity id a `where` pins, or `undefined` when it can match
 * more than one row. Top-level keys and `AND` members are conjunctions,
 * so any of them may carry the full primary key.
 */
export const entityId = (
	model: PluginModelInfo,
	where: unknown,
): string | undefined => {
	if (!isRecord(where) || !model.primaryKey.length) return;
	const values: unknown[] = [];
	for (const field of model.primaryKey) {
		const value = primaryKeyValue(where[field]);
		if (value === undefined) break;
		values.push(value);
	}
	if (values.length === model.primaryKey.length) return canonicalize(values);

	const and = where.AND;
	for (const member of Array.isArray(and) ? and : [and]) {
		const id = entityId(model, member);
		if (id) return id;
	}
};

/** Entity ids a write `where` targets, or `undefined` when unknown. */
const entityIds = (
	model: PluginModelInfo,
	where: unknown,
): string[] | undefined => {
	const id = entityId(model, where);
	if (id) return [id];
	const [field] = model.primaryKey;
	if (model.primaryKey.length !== 1 || !isRecord(where) || !field) return;
	const filter = where[field];
	if (!isRecord(filter) || !Array.isArray(filter.in)) return;
	const ids: string[] = [];
	for (const value of filter.in) {
		if (!isKeyValue(value)) return;
		ids.push(canonicalize([value]));
	}
	return ids;
};

const rowIds = (model: PluginModelInfo, rows: readonly unknown[]) => {
	const ids: string[] = [];
	for (const row of rows) {
		const id = entityId(model, row);
		if (!id) return;
		ids.push(id);
	}
	return ids;
};

const setsPrimaryKey = (model: PluginModelInfo, data: unknown) =>
	isRecord(data) &&
	model.primaryKey.some((field) => data[field] !== undefined);

export const readDependencies = (
	keys: VersionKeys,
	models: Models,
	model: PluginModelInfo,
	input: {
		include?: unknown;
		select?: unknown;
		where?: unknown;
	},
	tags: readonly string[],
): ReadDependencies => {
	const found = new Map<string, boolean>();
	const add = (key: string, emptyOnly = false) => {
		if (!emptyOnly || !found.has(key)) found.set(key, emptyOnly);
	};
	const addModel = (name: string | undefined) => {
		if (!name) return;
		add(keys.epoch(name));
		add(keys.rows(name));
	};
	const addRelation = (source: PluginModelInfo, name: string) => {
		const relation = source.relations[name];
		if (!relation) return;
		addModel(relation.model);
		addModel(relation.through);
		return models[relation.model];
	};
	const walkWhere = (source: PluginModelInfo, where: unknown): void => {
		if (Array.isArray(where)) {
			for (const member of where) walkWhere(source, member);
			return;
		}
		if (!isRecord(where)) return;
		for (const key in where) {
			const value = where[key];
			if (LOGICAL.has(key)) {
				walkWhere(source, value);
				continue;
			}
			const target = addRelation(source, key);
			if (!target || !isRecord(value)) continue;
			for (const filter in value)
				if (RELATION_FILTERS.has(filter))
					walkWhere(target, value[filter]);
			walkWhere(target, value);
		}
	};
	const walkProjection = (
		source: PluginModelInfo,
		projection: unknown,
	): void => {
		if (!isRecord(projection)) return;
		for (const key in projection) {
			const value = projection[key];
			if (!value) continue;
			if (key === '_count') {
				const counted = isRecord(value) ? value.select : undefined;
				if (!isRecord(counted)) {
					for (const name in source.relations)
						addRelation(source, name);
					continue;
				}
				for (const name in counted) {
					const target = addRelation(source, name);
					const selector = counted[name];
					if (target && isRecord(selector))
						walkWhere(target, selector.where);
				}
				continue;
			}
			const target = addRelation(source, key);
			if (!target || !isRecord(value)) continue;
			walkWhere(target, value.where);
			walkProjection(target, value.select);
			walkProjection(target, value.include);
		}
	};

	add(keys.all);
	add(keys.epoch(model.name));
	const id = entityId(model, input.where);
	if (id) {
		add(keys.entity(model.name, id));
		add(keys.rows(model.name), true);
	} else add(keys.rows(model.name));
	walkWhere(model, input.where);
	walkProjection(model, input.select);
	walkProjection(model, input.include);
	for (const tag of tags) add(keys.tag(tag));

	return {
		emptyOnly: [...found.values()],
		keys: [...found.keys()],
	};
};

/**
 * Version keys a successful write must bump. Writes with a known target
 * bump the rows version plus each touched entity. Any other write bumps
 * the model epoch, which every read of the model depends on.
 */
export const writeDependencies = (
	keys: VersionKeys,
	models: Models,
	model: PluginModelInfo,
	input: {
		args: MutableRecord;
		data?: unknown;
		kind: string;
		where?: unknown;
	},
): Set<string> => {
	const found = new Set([keys.rows(model.name)]);
	const epoch = (name: string | undefined) => {
		if (name) found.add(keys.epoch(name));
	};
	const entities = (ids: readonly string[] | undefined) => {
		if (!ids) return epoch(model.name);
		for (const id of ids) found.add(keys.entity(model.name, id));
	};
	const relationWrites = (data: unknown) => {
		if (!isRecord(data)) return;
		for (const key in data) {
			const relation = model.relations[key];
			const value = data[key];
			if (!relation || !isRecord(value)) continue;
			for (const operation in value)
				if (RELATION_WRITES.has(operation)) {
					epoch(relation.model);
					epoch(relation.through);
					break;
				}
		}
	};
	// Database cascades reach rows that hold a foreign key to this model.
	const cascades = () => {
		for (const name of cascadeDependencies.get(models)?.get(model.name) ??
			[])
			epoch(name);
	};
	const references = cascadeColumns.get(models)?.get(model.name);
	const changesReference = (data: unknown) => {
		if (!isRecord(data)) return false;
		for (const field of references ?? [])
			if (data[field] !== undefined) return true;
		return false;
	};
	const { args, data, kind, where } = input;

	switch (kind) {
		case 'create':
			relationWrites(data);
			break;
		case 'createMany':
			break;
		case 'upsert': {
			const upsert = isRecord(data) ? data : {};
			relationWrites(upsert.create);
			relationWrites(upsert.update);
			entities(entityIds(model, where));
			if (setsPrimaryKey(model, upsert.update)) epoch(model.name);
			if (changesReference(upsert.update)) cascades();
			break;
		}
		case 'upsertMany': {
			const target = args.target;
			const fields = Array.isArray(target) ? target : [target];
			const byPrimaryKey =
				fields.length === model.primaryKey.length &&
				model.primaryKey.every((field) => fields.includes(field));
			entities(
				byPrimaryKey && Array.isArray(data)
					? rowIds(model, data)
					: undefined,
			);
			const update = args.update;
			const changes = (column: string) =>
				typeof update === 'function' ||
				(update === 'all' && !fields.includes(column)) ||
				(Array.isArray(update) && update.includes(column)) ||
				(isRecord(update) && update[column] !== undefined);
			if (model.primaryKey.some(changes)) epoch(model.name);
			for (const field of references ?? [])
				if (changes(field)) {
					cascades();
					break;
				}
			break;
		}
		case 'update':
		case 'updateMany':
			relationWrites(data);
			entities(entityIds(model, where));
			if (setsPrimaryKey(model, data)) epoch(model.name);
			if (changesReference(data)) cascades();
			break;
		case 'updateEach': {
			const by = isRecord(args.by) ? columnKeys.get(args.by) : args.by;
			const fields = Array.isArray(by) ? by : [by];
			const byPrimaryKey =
				fields.length === model.primaryKey.length &&
				model.primaryKey.every((field) => fields.includes(field));
			entities(
				byPrimaryKey && Array.isArray(data)
					? rowIds(model, data)
					: undefined,
			);
			if (setsPrimaryKey(model, args.update)) epoch(model.name);
			if (changesReference(args.update)) cascades();
			break;
		}
		case 'delete':
		case 'deleteMany':
			entities(entityIds(model, where));
			cascades();
			break;
	}

	return found;
};

export const isEmptyResult = (value: unknown) => {
	if (value === null || value === false || value === 0) return true;
	if (Array.isArray(value)) return value.length === 0;
	return isRecord(value) && Array.isArray(value.data) && !value.data.length;
};
