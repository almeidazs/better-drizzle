import Image from 'next/image';
import { cn } from '@/lib/utils';

export function Logo({ className }: { className?: string }) {
	return (
		<Image
			src="/icon.png"
			alt="better-drizzle"
			width={865}
			height={289}
			className={cn('h-auto w-28 object-contain', className)}
			priority
		/>
	);
}

export function Wordmark({ className }: { className?: string }) {
	return <Logo className={cn('w-36', className)} />;
}
