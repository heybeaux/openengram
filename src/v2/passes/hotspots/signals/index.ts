/**
 * Barrel for Pass 4 hotspot signal collectors.
 *
 * Each signal lives in its own file and exports a pure async `collect*`
 * function plus its option/result types. The orchestrator imports from
 * here so adding a new signal is a one-line re-export.
 */

export {
  collectGitChurn,
  DEFAULT_WINDOW_DAYS,
  type GitChurnOptions,
  type GitExec,
} from './git-churn';
export { collectInDegree, type InDegreeOptions } from './in-degree';
export { collectComplexity, type ComplexityOptions } from './complexity';
export { collectCoverage, type CoverageOptions } from './coverage';
export type {
  GitChurnSignal,
  InDegreeSignal,
  ComplexitySignal,
  CoverageSignal,
} from '../types';
