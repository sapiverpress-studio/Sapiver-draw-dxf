# Guided dimension review — isolated UX development (2026-11-03)

Branch: `feature/guided-dimension-review-20261103`
Base: `main` at ff9018c29bc6d06683ce3130db8e599e3eee3558

## Explicit user requirements
- Use **Edit**, not **Correct**, beside **Confirm** for each measurement.
- Retain customer name, job reference, staff/date and saved-job search at the top of the page.
- Make dimensions easier to verify without weakening the deterministic geometry safeguards.
- Do not deploy to production without separate authorisation.

## Implemented
- A focused dimension review that displays one active measurement at a time, ordered from perimeter to cut-outs, then any process/finish confirmations.
- A read-only measured value until the user selects **Edit**. Existing validation, confirmation and approval-invalidation handlers remain authoritative.
- Previous/Next/Skip navigation; skipped items remain unconfirmed, so the existing manufacturing release gate stays closed.
- View switch between **Original** and **DXF preview** instead of stacking two tall previews on mobile.
- Progress bar and active-feature names with redundant old progress count hidden while the guided view is active.
- Unassigned AI reads remain visible by default and can be collapsed; clarification warnings remain visible.
- Existing job details, saved search, manual drawing, customer signature, revision locking, DXF output and share workflow remain untouched.
- Controlled Netlify production packaging updated so a future authorised deploy includes the two new frontend files.
- Browser regression fixture tests Edit, confirm/advance, switching views, preserved job header, saved search and feature navigation.

## Deliberate limitations and follow-up
- Highlighting the active measurement *on the CAD canvas* is not implemented: the current SVG renderer does not provide dependable element-to-dimension IDs for every case. Do not imply that the location is highlighted until a robust mapping is added.
- This is a new frontend presentation layer over the existing card controls, not a change to the geometry engine.
- Run a supervised Android UX test with a simple dimensioned rectangular panel and socket cut-out before merging.
- Confirm that preview toggling, focus, zoom and any unlinked dimensions remain understandable on a real phone.
- Do not merge or deploy without explicit instruction.

## Validation
The branch has a dedicated non-deploy GitHub Actions workflow:
`Guided drawing review checks (no deploy)`.
It runs JavaScript syntax checks, existing geometry/AI/review/PDF/release checks and a Chromium UI test using a synthetic job.
No production DXF output or live external AI calls were exercised by that browser test.
