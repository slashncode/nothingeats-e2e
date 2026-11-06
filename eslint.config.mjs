import antfu from '@antfu/eslint-config';

export default antfu({
    typescript: true,

    // Same style as the other NothingEats TypeScript repos.
    stylistic: {
        indent: 4,
        quotes: 'single',
        semi: true,
    },

    // Workflows and other YAML keep the 2-space indent used across the NothingEats repos.
    yaml: {
        overrides: {
            'yaml/indent': ['error', 2],
        },
    },

    ignores: [
        'playwright-report/**',
        'test-results/**',
        'artifacts/**',
        // Owned by pnpm, which rewrites it.
        'pnpm-workspace.yaml',
    ],
});
