# Sage X3 -> NRS e-invoicing middleware

Polls Sage X3 for new sales invoices and credit notes and submits them to the Cryptware
FIRS/NRS e-invoicing API (`https://preprod-api.cryptwaresystemsltd.com`), tracking each
document's sync state (submitted / synced / failed) and IRN in `data/sync-state.json`.

## How it works

Every `POLL_INTERVAL_MINUTES` minutes:

1. **syncInvoices** - fetches new invoices from Sage X3, maps each to the NRS invoice
   payload, and POSTs it to `/invoice/generate`. The returned IRN is stored locally.
2. **syncCreditNotes** - fetches new credit notes from Sage X3. Each credit note is
   submitted via `/invoice/generate` with `invoice_type_code` = "Credit Note" and
   `cancel_references` pointing at the original invoice's IRN + issue date. If the
   original invoice hasn't synced yet (no IRN on record), the credit note is deferred
   until it has (status `AWAITING_PARENT`).
3. **reconcileStatuses** - polls `/invoice/{irn}/status` for everything still in flight,
   marks documents `SYNCED` once FIRS reports `SIGNED`/`TRANSMITTED`, and automatically
   calls `/invoice/{irn}/retry` on `FAILED` documents (up to `MAX_SUBMIT_ATTEMPTS`).

The NRS invoice-type codes (e.g. which numeric code means "Credit Note" vs "Commercial
Invoice") are resolved at runtime from `/reference-data/invoice-types` rather than
hardcoded - the codes turned out not to match the descriptions in the API's own docs
(confirmed live: `380` = Credit Note, `381` = Commercial Invoice).

### API quirks discovered while verifying against the live sandbox

The Cryptware API's own OpenAPI/Swagger docs are wrong or misleading in a few places -
these were only caught by actually submitting a real invoice (`npm run nrs:smoke-test`):

- `issue_date` / `due_date` / `original_issue_date` are documented as `date-time` but the
  API rejects anything but plain `YYYY-MM-DD`. Handled in `src/nrs/mapper.ts` (`toDateOnly`).
- Every invoice line requires an `hsn_code` in `0000.00` format (e.g. `2701.90`) - the
  spec's own example (`"CC-001"`) does not pass validation.
- `price_unit` must be a UN/CEFACT Recommendation 20 unit code (e.g. `EA`, `KGM`, `C62`)
  from `GET /reference-data/uom`, not free text - the spec's own example (`"NGN per bag"`)
  is rejected. `src/sage/types.ts` documents this on `SageInvoiceLine.priceUnit`; Sage X3's
  UOM codes will need mapping to this list when finishing `fetchDocuments.ts`.

Run `npm run nrs:smoke-test` after any change to the mapper or client to confirm the NRS
side still round-trips correctly.

## Setup

```
npm install
cp .env.example .env   # then fill in real values (a working .env already exists in this repo)
npm run dev
```

For production: `npm run build && npm start`.

## Sage X3 integration - what's still needed

`src/sage/fetchDocuments.ts` is the one unfinished boundary. Everything downstream
(NRS client, mapping, sync/retry/state logic) is complete and tested against the real
NRS API. What's missing is specific to how PE Energy's Sage X3 is deployed:

1. **Which API is exposed on `erp.peenergy.net`?** Sage X3 can expose either the legacy
   SOAP "Web Services" (entities like `BPCINVOICE`) or a newer REST/OData-style API.
   Ask the Sage X3 admin/consultant which is enabled and get the entity name for sales
   invoices and credit notes.
2. Set `SAGE_INVOICE_ENDPOINT` / `SAGE_CREDIT_NOTE_ENDPOINT` in `.env` to the confirmed
   path.
3. Run `SAGE_INSPECT_PATH=<path> npm run sage:inspect` to fetch a real sample and see
   the actual field names.
4. Fill in the two `mapRawTo*` functions in `src/sage/fetchDocuments.ts` (currently
   placeholder field names marked `CONFIRM`) to match what step 3 showed.

Once that's done, `fetchNewInvoices` / `fetchNewCreditNotes` return normalized
`SageInvoice` / `SageCreditNote` objects (see `src/sage/types.ts`) and the rest of the
pipeline needs no changes.

## Notes

- `.env` holds real credentials (Sage X3 basic auth, NRS API key) and is gitignored.
- State is a single JSON file for simplicity; swap `src/store.ts` for SQLite/Postgres
  if volume grows or multiple instances need to share state.
- `NRS_BASE_URL` currently points at Cryptware's **pre-prod** environment - switch it
  (and `NRS_API_KEY`) when moving to the live FIRS environment.
