type ClassValue = string | false | null | undefined;

/**
 * Tiny class-name joiner. Keeps the component code readable without pulling in
 * an extra dependency for what is, in practice, string concatenation.
 */
export function cn(...inputs: ClassValue[]): string {
	return inputs.filter(Boolean).join(' ');
}
