# Verification evidence

Recorded on 22 November 2026. All prompts and files in this evidence are synthetic public test data. No personal documents, credentials, private chat history, or real sensitive content were used.

## Local suite: 78/78

[`verification.json`](verification.json) records 78 passing checks: six bootstrap/CSP checks, 37 baseline checks, and 35 extra regressions. It records Chrome 157, Node 22.23.5, Linux, no test-only sandbox bypass, and successful temporary-profile removal.

Supporting results:

- [`bootstrap-results.json`](bootstrap-results.json): inherited pipe, first-script initialization, restrictive CSP, current anonymous ChatGPT response selector.
- [`e2e-results.json`](e2e-results.json): clean/flagged prompts, text/PDF/PNG inspection, native decisions, approval isolation, and response-selector fixtures.
- [`extended-results.json`](extended-results.json): exact bytes, request variants, XHR, changed prompts, worker-upload gesture timing, paste/drop, scan failures, size limits, scanned PDFs, clean images.
- [`demo-receipts.json`](demo-receipts.json): three actual local-server receipts from the separately recorded fixture demo. Canceled actions do not create receipts.
- [`npm-audit-runtime.json`](npm-audit-runtime.json) and [`npm-audit-all.json`](npm-audit-all.json): dependency audit output captured for this delivery.

`liveSitesTested: false` in the local suite is deliberate: `npm test` never visits the AI services. The separate live result below covers only the stated ChatGPT flow.

## Actual standalone ChatGPT test

[`live-chatgpt-results.json`](live-chatgpt-results.json) is from the actual standalone application, launched with a fresh anonymous profile and Chrome's normal sandbox:

| Check | Observed result |
|---|---|
| Clean dummy prompt | Submitted; READY response rendered |
| Flagged dummy prompt | Native desktop confirmation opened |
| Before decision | Zero distinct marker-bearing network requests observed |
| Cancel | Zero distinct marker-bearing network requests observed |
| Retry | Fresh native confirmation opened |
| Continue | One distinct marker-bearing request; visible marker response |
| Response style | Root and paragraph computed color `rgb(109, 40, 217)` for both answers |
| Upload menu | Add files listed under a login requirement; no upload bypass attempted |

Two diagnostic sessions observed the same approved request. The result preserves those observations and separately lists the distinct request, deduplicated by protocol request ID and URL. Request count is not inferred from the number of diagnostic events.

Screenshots:

- [`chatgpt-clean.png`](chatgpt-clean.png)
- [`chatgpt-native.png`](chatgpt-native.png)
- [`chatgpt-result.png`](chatgpt-result.png)
- [`chatgpt-upload-login.png`](chatgpt-upload-login.png)

Live URL: https://chatgpt.com/

## Actual anonymous ChatGPT PNG upload

The normal **Add photos** menu opens a file chooser without login. The flagged public PNG was tested through that ordinary UI path, with no hidden-input bypass.

[`live-chatgpt-image-results.json`](live-chatgpt-image-results.json) records:

- Native confirmation before proceeding; Cancel leaves no attachment.
- No file-registration or binary-upload request observed before the decision or after Cancel. Ordinary analytics POSTs do occur; this is not a claim of zero total network activity.
- Retry opens a fresh native confirmation.
- Continue is followed by file-registration HTTP 200, binary PUT HTTP 201, processing HTTP 200, and a visible `flagged.png` attachment.
- No second native dialog appeared after Continue.

Screenshots: [`chatgpt-image-native.png`](chatgpt-image-native.png), [`chatgpt-image-cancel.png`](chatgpt-image-cancel.png), and [`chatgpt-image-result.png`](chatgpt-image-result.png). Temporary signed-upload URL query strings are removed from the publishable trace. Actual service-side original-byte identity is not claimed; exact-byte checks belong to the local suite.

The separate **Add files** entry is login-gated. Text/PDF, signed-in, and paste/drop service uploads remain unverified.

## Perplexity: not a pass

The actual standalone route at https://www.perplexity.ai/ remained at a Cloudflare checkbox after two normal attempts. The attempt was stopped. [`perplexity-challenge.png`](perplexity-challenge.png) records the challenge state.

No native-app Perplexity prompt, upload, or response-color pass is claimed. Opening the site in another browser would not prove this application's enforcement.

## Recording labels

The final video separates:

1. Actual logged-out ChatGPT prompt decisions, response recoloring, and PNG selection through Add photos.
2. A **local fixture** demonstrating file formats and native decisions with server receipts.
3. Explicit live-test gaps and the app's limited security boundary.

The local fixture is not ChatGPT or Perplexity. Its two response boxes are synthetic selector fixtures, not live AI answers. A file-contents pass on the fixture is not a live-service upload pass.

## Still unverified

- Text/PDF, authenticated, and paste/drop uploads and post-upload service behavior not covered by the anonymous PNG check.
- All native-app Perplexity acceptance flows.
- Arbitrary nonblank new tabs/popups, hostile pages, and arbitrary programmatic worker sends, which are outside the verified protection boundary.
- Windows and macOS dialog adapters.

The README contains setup steps, implementation details, limits, and the commands for reproducing the local suite and optional anonymous ChatGPT smoke test.
