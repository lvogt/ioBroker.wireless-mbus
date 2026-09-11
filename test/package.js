const path = require('node:path');
const { tests } = require('@iobroker/testing');

// Validate the package files
//
// The jsonConfig validation added in @iobroker/testing 6.2.0 checks
// admin/jsonConfig.json against the schema of ioBroker/json-config, and that
// schema is wrong about two properties we use: it names the infoBox property
// "closable" although the control reads "closeable", and jsonEditorProps omits
// help/helpLink although ConfigJsonEditor renders them. Both make the check
// fail on a config that works. Drop the option once the schema is fixed.
tests.packageFiles(path.join(__dirname, '..'), {
    ignoreJsonConfigValidation: true,
});
