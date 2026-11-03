# Drawing Desk — Guided review integration (2026-11-03)

## Objective
Integrate the existing full Quick DXF application with the improved UX. The original
camera upload, PDF/image upload, OpenAI drawing analysis, manual drawing,
manufacturing settings, customer approval, signed release and DXF export must remain
intact. The stand-alone no-login mock is *not* part of the application.

## Operator workflow
1. At the top select **New job** or **Saved job**.
2. New job: enter reference, customer, staff/date; take a photograph, upload a
   drawing/PDF, or enter a measured panel manually.
3. Existing job: search by reference or customer and load the record.
4. For a captured drawing, set glass thickness and toughening status, then run the
   existing protected OpenAI analyser to identify perimeter dimensions, cut-outs,
   holes and measurement relationships.
5. Review one dimension at a time. **Confirm** accepts the interpreted measurement;
   **Edit** lets the operator correct it. Previous/Next/Skip never automatically
   confirm missing information.
6. Final checks and signed release retain existing guards.

## Deployment-sensitive data storage
**Production** functions must keep reading the **same site-wide** Netlify Blobs
store `quick-dxf-jobs` as before this UX change; do not migrate/delete existing
jobs or signed files. **Deploy previews**, branch deploys and unknown contexts
instead use a deploy-scoped store. The context comes from each Netlify function's
`context.deploy.context`, passed through to the storage helper.

Handlers requiring this context:
- `netlify/functions/access.mjs`
- `netlify/functions/jobs.mjs`
- `netlify/functions/job-file.mjs`
- `netlify/functions/analyse-drawing.mjs`

Each retains authentication. The OpenAI key is server-side; no unauthenticated AI
request is permitted.

## Verification
- GitHub Actions: native analysis-integrity, deterministic geometry, curved profiles,
  review-model, PDF, release and UI contract checks.
- Chromium: guided dimension verification, editing, next/previous/skip and preserved
  customer/job-search fields.
- Production integration contract: protected AI endpoint and image/camera entry
  remain in HTML and JS; production storage remains site-wide while previews
  cannot read/write production blobs.

Limitations:
- Automated regression passing does **not** prove live OpenAI recognition accuracy,
  phone hardware camera activation, or factory machine compatibility.
- The preview login has previously returned HTTP 503 when the deployment's auth
  configuration was invalid. Netlify credentials need separate operational validation;
  changing UX or merging code does not resolve the credentials.
- A screenshot-level highlight linked to every confirmed dimension has not yet been
  implemented; do not claim it is.
- Production deployment must be verified independently after the merge. A commit on
  GitHub `main` is not evidence of a successful Netlify production deployment.
