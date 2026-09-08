# Sapiver Draw DXF

Prototype for **Quick DXF**: a trade-counter/site workflow for turning simple customer sketches, photos and PDFs into checked production DXFs with a signed confirmation record.

## Current v1 flow

1. Create/search a shared job.
2. Add one or multiple source images/PDFs.
3. GPT-5.6 Sol proposes parts, features and figured dimensions.
4. Assistant/customer confirms every production dimension, including centre/edge intent and the outer edge used for positional dimensions.
5. Deterministic code reconstructs clean geometry from the confirmed dimension IDs; AI numeric geometry is not authoritative.
6. Generate a clean confirmation PDF from that same deterministic geometry.
7. Print, obtain the customer signature, then photograph the signed confirmation back into the job.
8. Release generates the DXF file(s), locks the revision and prepares the production/customer export pack.
9. Confirm & email the pack. The job is marked Sent only after successful email.
10. The work server remains the permanent production archive.

Customer DXF export pricing currently shown in the prototype: **£5 single drawing / £10 multiple drawings in the same job**.

## Shared multi-device storage

The prototype includes Netlify Functions backed by strongly consistent Netlify Blobs for shared in-progress jobs and files. Revisions are stored separately from the current job head so signed revisions remain immutable and retrievable. Browser localStorage is only an emergency unsynced cache, not the primary record.

Stored in-progress data includes job metadata, source drawings, AI proposals, confirmed dimensions, confirmation PDF, signed-photo proof, DXF references and send state.

## Deterministic geometry support

The current v1 engine supports:

- rectangular outer profiles
- circular outer profiles
- rectangular cut-outs
- circular holes
- slots
- centre-referenced feature positions
- edge-referenced feature positions from left/right/top/bottom
- DXF `LWPOLYLINE` and `CIRCLE` output in millimetres

The engine deliberately blocks release for geometry it does not yet implement safely, including notches, arbitrary polygons/irregular profiles, repeated unlocated features and general arcs/radii. Those should be added only with deterministic rules and tests rather than guessed from the image.

## AI architecture

- Browser uploads the source to shared temporary storage.
- A server-side function calls the OpenAI Responses API using `gpt-5.6-sol`.
- Structured output gives every figured dimension a stable ID.
- Every outer-profile size and feature size/position must link to the exact figured dimension ID that supports it.
- The deterministic engine ignores AI numeric geometry values when creating production geometry and uses the human-confirmed linked dimensions instead.
- Model confidence never auto-approves a production value.

The repository still includes the earlier controlled GitHub Actions benchmark under `run-tests/` for comparing recognition on representative drawings.

## Confirmation and release

The confirmation PDF is generated from the same deterministic geometry later used for DXF output, reducing the risk of the signed drawing and manufacturing file disagreeing.

Signed/locked revisions cannot be mutated through the shared job/file endpoints. Creating a later change advances to the next revision rather than overwriting the signed one.

The email release function expects server environment configuration for the production sender/recipient and Brevo. These values are intentionally not committed to GitHub.

## Tests

`.github/workflows/geometry-tests.yml` runs no-cost prototype checks on `prototype-v1`:

- JavaScript syntax checks across browser, core and Netlify Functions
- deterministic geometry tests
- centre/edge coordinate behaviour
- millimetre DXF output checks
- safety blocking for unresolved/unsupported geometry

## Deployment rule

**Netlify deployment is intentionally separate from GitHub development and must not be triggered without explicit approval.**
