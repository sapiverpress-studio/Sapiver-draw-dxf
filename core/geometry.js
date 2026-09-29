import * as base from './geometry-base.js';
import { analysisIntegrityIssues } from './analysis-integrity.js';

export * from './geometry-base.js';

export function compileSourceGeometry(source) {
  const integrityIssues = analysisIntegrityIssues(source?.analysis, { strictGeometry: true });
  if (integrityIssues.length) {
    return {
      ok: false,
      errors: integrityIssues.map((issue) => `Analysis integrity: ${issue}`),
      parts: [],
    };
  }
  return base.compileSourceGeometry(source);
}
