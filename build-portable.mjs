import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

await build({
  entryPoints: [fileURLToPath(new URL('./portable-entry.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('./firecrawl-filters.mjs', import.meta.url)),
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  target: 'es2022',
  legalComments: 'inline',
  banner: { js: '// Generated from portable-entry.ts and processing.ts. Rebuild: node build-portable.mjs\n// Standalone ESM: no installation, API key or network requests required.' },
});
