import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

// Full-text docs search, powered by Fumadocs' built-in Orama index.
export const { GET } = createFromSource(source);
