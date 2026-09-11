/**
 * Resolve the app's "@/..." alias so its modules can run outside Next.
 *
 * Next rewrites that alias at build time and infers the .ts extension; plain
 * Node does neither, so a library importing a sibling through "@/lib/..." dies
 * with ERR_MODULE_NOT_FOUND the moment a verify script touches it. Registered
 * with --import so it is in place before the first import resolves.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { register } from 'node:module';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

export async function resolve(specifier, context, next) {
    if (specifier.startsWith('@/')) {
        const base = join(SRC, specifier.slice(2));
        for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
            if (existsSync(candidate)) return next(`file://${candidate}`, context);
        }
    }
    return next(specifier, context);
}

// Self-registering, so a script only needs `--import ./scripts/alias-loader.mjs`.
if (!process.env.__CV_ALIAS_LOADER__) {
    process.env.__CV_ALIAS_LOADER__ = '1';
    register('./alias-loader.mjs', import.meta.url);
}
