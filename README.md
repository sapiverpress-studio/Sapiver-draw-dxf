# Sapiver Draw DXF

Browser-first prototype for converting dimensioned drawings and workshop sketches into DXF cut geometry with a mandatory human verification step.

## Current prototype

- Opens PNG, JPG, WebP and the first page of a PDF.
- Operator marks figured dimensions by clicking two points.
- Dimensions can be edited, confirmed, ignored, and one can be chosen as the scale reference.
- The review panel shows how other figured dimensions compare with the selected image scale.
- Operator traces one or more closed cut shapes.
- Exports a millimetre DXF containing closed `LWPOLYLINE` entities on the `CUT` layer.
- Processing is local in the browser. No drawing is uploaded by this prototype.

## Safety rule

The image itself is not treated as authoritative scale. A figured dimension must be explicitly confirmed and selected as the scale reference before DXF export is enabled.

Phone photographs with perspective distortion should not be treated as production-accurate from one scale reference. Perspective correction / multi-constraint reconstruction belongs in a later stage.

## Architecture

- `index.html` — static shell
- `styles.css` — responsive workshop UI
- `app.js` — drawing review state and interaction
- `core/dxf.js` — isolated DXF writer intended to be reusable when the project moves to Expo

No build step is currently required.

## Planned next stages

1. Geometry editing and delete/redo controls.
2. Multi-page PDF selection.
3. Perspective correction for photographed sketches.
4. Automatic dimension/geometry suggestions feeding the same human-review model.
5. Reuse the core geometry/DXF logic in Expo once the browser workflow is proven.
