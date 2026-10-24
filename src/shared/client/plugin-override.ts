// Shared across the core and separately bundled plugin entry points.
const deferredOperation = Symbol.for('better-drizzle/deferred-operation');

type DeferredPluginOperation = {
	[deferredOperation]: (next: () => Promise<unknown>) => unknown;
};

/** Internal override that runs at the SQL boundary, inside every intercept. */
export const deferPluginOperation = (
	execute: DeferredPluginOperation[typeof deferredOperation],
): DeferredPluginOperation => ({ [deferredOperation]: execute });

export const resolvePluginOverride = <Result, Args>(
	result: unknown,
	operation: (args: Args) => Promise<Result>,
	args: Args,
): Promise<Result> => {
	const execute =
		typeof result === 'object' && result !== null
			? (result as Partial<DeferredPluginOperation>)[deferredOperation]
			: undefined;
	return Promise.resolve(
		typeof execute === 'function' ? execute(() => operation(args)) : result,
	) as Promise<Result>;
};
