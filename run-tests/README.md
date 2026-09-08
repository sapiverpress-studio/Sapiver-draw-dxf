# Quick DXF AI test input

Uploading a supported drawing into this folder on the `prototype-v1` branch deliberately triggers **one paid OpenAI API analysis** for the first supported drawing in that commit.

Supported test files: `.png`, `.jpg`, `.jpeg`, `.webp`, `.pdf`.

## Cost control

- The workflow runs only when a supported drawing is pushed into `run-tests/` on `prototype-v1`.
- Normal code commits elsewhere do not call the API.
- The OpenAI client has automatic retries disabled.
- The workflow makes one Responses API analysis call using `gpt-5.6-terra` at low reasoning effort.
- Results are stored only as a GitHub Actions artifact for 7 days; they are not committed to the repository.
- Responses are requested with `store: false`.
- PDFs are temporarily uploaded to OpenAI as `user_data` and the script attempts to delete the temporary file immediately after analysis.

## How to test

1. Make sure GitHub shows branch `prototype-v1`.
2. Open this `run-tests` folder.
3. Choose **Add file → Upload files**.
4. Upload one real simple customer drawing.
5. Commit directly to `prototype-v1`.
6. Open **Actions → Quick DXF AI test**.
7. Open the new run when it finishes and download the `quick-dxf-analysis-*` artifact.

The JSON artifact includes the extracted dimensions/features, uncertainties, token usage and an estimated API cost. Do not manufacture from the AI result; it is an extraction benchmark until the customer/assistant verification layer is integrated.
