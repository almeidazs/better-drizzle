import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

// Full-text docs search, powered by Fumadocs' built-in Orama index.
export const { GET } = createFromSource(source);
