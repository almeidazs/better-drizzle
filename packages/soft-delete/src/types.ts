import type {
	AnyPlugin,
	AnySchema,
	BetterDrizzleModelDelegate,
	BetterTableKey,
} from 'better-drizzle';

export type SoftDeleteMode = 'soft' | 'hard';

export type SoftDeleteVisibility = 'without' | 'with' | 'only';

export type SoftDeleteDefaultVisibility = Exclude<SoftDeleteVisibility, 'only'>;

export type SoftDeleteOptions = {
	column?: string;
	deletedByColumn?: string;
	defaults?: {
		mode?: SoftDeleteMode;
		visibility?: SoftDeleteDefaultVisibility;
	};
};

export const DEFAULT_COLUMN = 'deletedAt';
export const DEFAULT_DELETED_BY_COLUMN = 'deletedById';
export const DEFAULT_MODE = 'soft';
export const DEFAULT_VISIBILITY = 'without';

export type MutableRecord = Record<string, unknown>;

export type AnyDelegate = BetterDrizzleModelDelegate<
	AnySchema,
	BetterTableKey<AnySchema>,
	unknown,
	readonly AnyPlugin[]
>;

export type RestoreModelExtension = {
	restore(args: {
		include?: Record<string, unknown>;
		meta?: unknown;
		select?: Record<string, unknown>;
		where: Record<string, unknown>;
	}): ReturnType<AnyDelegate['update']>;
	restoreById(
		id: string | number | bigint,
		args?: {
			include?: Record<string, unknown>;
			meta?: unknown;
			select?: Record<string, unknown>;
		},
	): ReturnType<AnyDelegate['update']>;
};
