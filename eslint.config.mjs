import config from '@iobroker/eslint-config';
import globals from 'globals';

export default [
    ...config,
    {
        ignores: [
            '.dev-server/',
            '.vscode/',
            'build/',
            '**/adapter-config.d.ts',
            '*.config.mjs',
        ],
    },
    {
        rules: {
            // The codebase is being converted to TypeScript, where parameter
            // and return types live in the signature rather than in JSDoc.
            // Requiring JSDoc now would mean writing type annotations twice -
            // and `require-jsdoc --fix` only inserts empty stubs, which
            // `no-blank-blocks` then rejects. Prose docs stay welcome; they
            // are simply not enforced.
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
            'jsdoc/require-param-description': 'off',
            'jsdoc/require-returns': 'off',

            // This rule reports "@type is redundant when using a type system"
            // and --fix then deletes the tag. That holds for TypeScript
            // sources, but these are .js files checked with checkJs, where a
            // JSDoc @type is the only way to state a type - and removing one
            // breaks `npm run check` silently. Re-enable once the sources are
            // really TypeScript.
            'jsdoc/check-tag-names': 'off',
        },
    },
    {
        // The receiver modules transcribe each device's full serial protocol as
        // UPPER_SNAKE_CASE constants. Only a subset is used, but the unused
        // ones document the protocol and belong next to the ones that are -
        // so allow unused module-level constants here, while still catching
        // unused locals and parameters.
        files: ['lib/receiver/*.js'],
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    varsIgnorePattern: '^[A-Z][A-Za-z0-9_]*$',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                },
            ],
        },
    },
    {
        // Test code and the serial device mocks. The shared config only
        // declares node globals, so mocha's describe/it/before/after need
        // adding, and the mocks deliberately keep unused protocol constants
        // and unused callback parameters to mirror the real interfaces.
        files: ['**/*.test.js', 'test/**/*.js'],
        languageOptions: {
            globals: {
                ...globals.mocha,
            },
        },
        rules: {
            '@typescript-eslint/no-unused-vars': [
                'error',
                {
                    varsIgnorePattern: '^[A-Z][A-Za-z0-9_]*$',
                    argsIgnorePattern: '^_',
                    caughtErrors: 'all',
                },
            ],
        },
    },
];
