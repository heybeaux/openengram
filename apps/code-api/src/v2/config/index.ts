/** Public surface for the EC-27 per-codebase config loader. */

export {
  CONFIG_DIRNAME,
  CONFIG_FILENAME,
  ConfigError,
  findConfigFile,
  loadConfig,
  loadConfigFromString,
  mergeWithDefaults,
} from './load';
export type { LoadConfigOptions, LoadConfigResult } from './load';

export { DEFAULT_CONFIG } from './defaults';

export { EngramConfigSchema } from './schema';
export type {
  EngramConfig,
  EngramConfigInput,
  ResolvedEngramConfig,
} from './schema';

export {
  contractsOptionsFromConfig,
  gotchasOptionsFromConfig,
  intentOptionsFromConfig,
  repositoryOptionsFromConfig,
  subsystemOptionsFromConfig,
} from './overrides';
