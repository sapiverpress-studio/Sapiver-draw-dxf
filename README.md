# Sapiver Draw DXF

Prototype for **Quick DXF**: a trade-counter/site workflow for turning a simple customer sketch, photo or PDF into a checked 2D DXF.

## Product direction

1. Shop assistant takes a photo or opens a customer image/PDF.
2. AI proposes the simple fabrication geometry and reads figured dimensions.
3. Assistant/customer reviews only the proposed values, including whether positional dimensions are measured to a **centre** or an **edge**.
4. Customer confirms the interpreted drawing.
5. Deterministic code generates the DXF from the confirmed data.
6. If manufacture is ordered, DXF preparation is included and the job can be retained for repeat work. If the customer wants the DXF file exported, the proposed counter price is £5 for one drawing or £10 for multiple drawings in the same job.

The AI interprets the source; it does not have final authority over production geometry.

## Current browser prototype

- Opens PNG, JPG, WebP and the first page of a PDF.
- Supports dimension review with explicit **size / centre / edge** reference types.
- Editing a confirmed dimension invalidates its confirmation until it is re-approved.
- Manual tracing remains available as a fallback while automatic interpretation is being tested.
- Exports millimetre DXF closed `LWPOLYLINE` geometry on the `CUT` layer.
- `core/dxf.js` is isolated for later reuse in Expo.

## Controlled AI benchmark

The repository contains a deliberately controlled GitHub Actions test harness:

- `tools/analyse_drawing.py` sends one drawing to the OpenAI Responses API and requests strict structured geometry/dimension JSON.
- `.github/workflows/analyse-drawing.yml` runs only when a supported drawing is pushed under `run-tests/` on branch `prototype-v1`.
- It uses repository secret `QUICK_DXF_API`.
- Automatic OpenAI retries are disabled so one trigger does not silently cause repeated model calls.
- The default benchmark model is `gpt-5.6-terra` with low reasoning effort.
- The response uses `store: false`.
- Temporary PDF uploads are deleted after analysis where possible.
- The result artifact contains extracted geometry, uncertainties, token usage and estimated API cost.

See `run-tests/README.md` before uploading a test drawing. Uploading a supported drawing there deliberately incurs an API call.

## Safety rules

- Figured dimensions are authoritative; never infer a production dimension from apparent image scale.
- Centre/edge positional intent must be confirmed where applicable.
- AI output is a proposal for human confirmation, not a manufacturing instruction.
- A DXF should not be treated as production-ready while required dimensions or geometric relationships remain unresolved.

## Architecture direction

- browser/Expo UI — capture and human verification
- vision/API layer — proposes geometry and dimensions
- structured job model — confirmed values and customer intent
- deterministic geometry/DXF engine — final file creation

Netlify deployment is intentionally separate from GitHub development and must not be triggered without explicit approval.
