import Image from 'next/image';

import { cn } from '@/lib/utils';

// `icon.png` has a white wordmark; `icon-light.png` is the same art with a dark
// wordmark for the light theme.
export function Logo({ className }: { className?: string }) {
	const classes = cn('h-auto w-28 object-contain', className);

	return (
		<>
			<Image
				src="/icon-light.png"
				alt="better-drizzle"
				width={865}
				height={289}
				className={cn(classes, 'dark:hidden')}
				priority
			/>
			<Image
				src="/icon.png"
				alt="better-drizzle"
				width={865}
				height={289}
				className={cn(classes, 'hidden dark:block')}
				priority
			/>
		</>
	);
}

export function Wordmark({ className }: { className?: string }) {
	return <Logo className={cn('w-36', className)} />;
}
