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
