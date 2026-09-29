import * as base from './_quick-dxf-analysis-base.mjs';
import { applyAnalysisIntegrity } from '../../core/analysis-integrity.js';

export const ANALYSIS_SCHEMA = base.ANALYSIS_SCHEMA;

export const ANALYSIS_PROMPT = `${base.ANALYSIS_PROMPT}

REPOSITORY-WIDE ANALYSIS INTEGRITY RULES — these are mandatory for every drawing, not shape-specific exceptions:
- Every figured production value must have exactly the correct geometry owner. A radius must never be used as a width, height, straight segment length or position merely because its numeric value happens to fit. A diameter must not be substituted for a radius, and an overall panel dimension must not be used as an internal feature size.
- When a dimension has a target such as p1.profile..., p1.profile.segments..., p1.profile.corner_radii... or p1.features..., the corresponding geometry *_dimension_id (or segment dimension_id) must contain that exact dimension id. If the geometry cannot own the target, the analysis is structurally incomplete: leave production_ready false and ask a precise question rather than returning an unlinked production figure.
- Before returning JSON, compare all extracted radius figures with the proposed geometry. If perimeter/outer-contour radii were extracted, the profile must contain the corresponding deterministic corner_radii or arc/quarter_arc/connect_arc path segments. Do not return several perimeter radius reads beside a rectangle/unknown profile with no curve geometry.
- Keep outer-perimeter curves separate from internal cut-outs. A perimeter radius must not be attached to a cut-out merely because the drawing also contains an internal opening, and an internal cut-out radius must not be used to define the outer perimeter.
- Notes saying radii, curves or contours are approximate, natural, variable, freehand, free-form or otherwise not mathematically exact are production constraints. Do not reverse-engineer the photograph. Mark unsupported geometry, keep production_ready false, and add a Template required: uncertainty unless exact CAD/coordinate geometry elsewhere in the drawing independently defines the boundary.
- If an outline is deterministic, describe the complete topology needed to manufacture it. If it is not deterministic, say so. Never make the confirmation UI responsible for inventing missing arc centres, tangent points or ownership relationships.
- Final integrity check: no clear production figure may survive only as an unassigned read when its target is known, and no geometry field may be linked to a dimension of the wrong semantic type.`;

export function linkExplicitDimensionTargets(extraction) {
  return base.linkExplicitDimensionTargets(extraction);
}

export function enforceAnalysisChecks(extraction) {
  return applyAnalysisIntegrity(base.enforceAnalysisChecks(extraction));
}
