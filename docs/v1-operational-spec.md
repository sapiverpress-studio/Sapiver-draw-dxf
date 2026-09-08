# Quick DXF v1 operational specification

## Purpose
Quick DXF is a trade-counter/site workflow for turning simple customer sketches, photos and PDFs into confirmed production DXFs with a signed approval record.

## Job model
A job may contain one or multiple source drawings/images/PDF pages. Each source has its own interpreted geometry and production dimensions, but the customer approves the complete job revision together.

## Production flow
1. Create job with job reference, customer and staff details.
2. Capture one or more photos or add images/PDFs.
3. AI proposes geometry, dimensions and feature references.
4. Assistant/customer confirms every production dimension. Positional dimensions must explicitly state centre, edge or unknown before release.
5. Generate a clean confirmation pack. Single-drawing jobs should fit clearly on one sheet where practical; multi-drawing jobs use an approval cover page plus drawing pages as needed so detail remains legible.
6. Print the confirmation pack.
7. Customer checks and signs the printed confirmation.
8. Assistant photographs the signed confirmation and attaches it to the job.
9. Lock the approved revision. Any later change creates a new revision; signed revisions are immutable.
10. Generate DXF file(s).
11. Confirm and send the released job by email.

## Release outcomes
### Manufacture with us
- DXF preparation is included with production.
- Email the production pack to the configured work/production email address.
- The work server is the permanent archive after release.

### Customer DXF export
- £5 for a single drawing.
- £10 for multiple drawings from the same job.
- Email the DXF file(s) and confirmation PDF to the customer.

## Release pack
The final released pack should contain, as applicable:
- DXF file(s)
- confirmation PDF
- signed confirmation photograph
- job reference/customer details
- original source drawing(s), if configured for production

A job is marked Sent only after the email operation succeeds.

## Shared temporary storage
The app only needs enough shared storage for in-progress jobs to be available from multiple authorised devices before completion. It is not the permanent DXF archive.

Shared in-progress data includes:
- job metadata
- source drawings
- AI proposals
- confirmed dimensions
- current revision/status
- signed confirmation image
- send status

After successful release, the work server remains the long-term production record. The app may retain a lightweight searchable history record such as job reference, customer, date, drawing count, revision and sent status.

## Safety rules
- Figured dimensions are authoritative; never manufacture from visual scaling of a sketch where a production dimension is absent.
- AI proposes; a human confirms every production dimension.
- Model confidence is never sufficient to auto-approve a production dimension.
- Centre/edge intent must be explicit for positional dimensions.
- Signed revisions are immutable.
- No customer production files should be committed to GitHub.
