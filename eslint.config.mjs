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

            // Every signature under src/ carries its own types; the override
            // below relaxes this for the tests, where the callbacks of
            // describe/it would only collect ": void".
            '@typescript-eslint/explicit-function-return-type': 'error',
            '@typescript-eslint/explicit-module-boundary-types': 'error',
            // the JSDoc @param types left over from the JavaScript sources
            'jsdoc/no-types': 'warn',
        },
    },
    {
        // The receiver modules transcribe each device's full serial protocol as
        // UPPER_SNAKE_CASE constants. Only a subset is used, but the unused
        // ones document the protocol and belong next to the ones that are -
        // so allow unused module-level constants here, while still catching
        // unused locals and parameters.
        files: ['src/lib/receiver/*.ts'],
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
        files: ['**/*.test.js', '**/*.test.ts', 'test/**/*.js', 'test/**/*.ts'],
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

            // Test code says what it means through its assertions, and the
            // tests are not an interface anything else builds on - annotating
            // every describe/it callback and every helper would be noise. The
            // sources they exercise are the ones that have to be typed.
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',

            // The tests are JavaScript checked with checkJs, where JSDoc is
            // the type syntax rather than a second copy of it - and a test of
            // a defensive branch has to hand in the value its types forbid,
            // which only a cast through `any` can do.
            'jsdoc/no-types': 'off',
            'jsdoc/reject-any-type': 'off',
        },
    },
    {
        // The developer scripts are run by hand and ship with nothing - they
        // are not part of the adapter, so the same goes for them.
        files: ['tools/**/*.js'],
        rules: {
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/explicit-module-boundary-types': 'off',
        },
    },
];
