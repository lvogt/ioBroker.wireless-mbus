// ts-node compiles the sources on the fly for the tests; point it at the root
// tsconfig so the test run sees the same settings as `npm run check`.
process.env.TS_NODE_PROJECT = require('node:path').resolve(__dirname, '../tsconfig.json');
process.env.TS_NODE_FILES = 'true';

// Don't silently swallow unhandled rejections
process.on('unhandledRejection', e => {
    throw e;
});
