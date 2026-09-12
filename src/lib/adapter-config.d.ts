// This file extends the AdapterConfig type from "@types/iobroker"
// using the actual properties present in io-package.json
// in order to provide typings for adapter.config properties

import { native } from '../io-package.json';

// The empty arrays in io-package.json infer as `never[]`, which cannot be
// narrowed to the real element types below - so drop them here and declare
// them explicitly in the augmentation.
type _AdapterConfig = Omit<typeof native, 'aeskeys' | 'blacklist'>;

// Augment the globally declared type ioBroker.AdapterConfig
declare global {
    namespace ioBroker {
        interface AdapterConfig extends _AdapterConfig {
            // Do not enter anything here!
            aeskeys: { id: string, key: string }[],
            blacklist: { id: string }[]
        }
    }
}

// this is required so the above AdapterConfig is found by TypeScript / type checking
export {};