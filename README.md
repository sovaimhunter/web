# TradeLynk Web (MVP)

A small web app for checking a Commercial Invoice, Packing List and Bill of
Lading for consistency before a shipment goes out. The flow is:

**Create shipment → Upload documents → Check documents → View results**

The server sends each uploaded PDF directly to OpenAI (gpt-4.1-mini, via the
Responses API `input_file` item), extracts a fixed 15-field set, and runs the
comparison rules against the three documents. The results page shows a
findings list plus a full field-by-field comparison table, with each field
labeled **match**, **requires review**, or **mismatch**.

## Run it

```bash
npm install
cp .env.local.example .env.local   # then add OPENAI_API_KEY
npm run dev                        # http://localhost:3000
```

Shipments and results are kept in the browser's `localStorage` — nothing is
persisted on the server.

## No API key? Use sample data

For UI development without calling OpenAI, set `EXTRACTION_MODE=mock` in
`.env.local`. The API then returns the bundled sample extraction
(`lib/mockData.ts`) instead of calling the model.

## Layout

- `app/(app)/page.tsx` — shipments dashboard
- `app/(app)/shipments/new/page.tsx` — create a shipment
- `app/(app)/shipments/[id]/documents/` — upload the three PDFs and run the check
- `app/(app)/shipments/[id]/results/` — findings + field-by-field comparison table
- `app/api/check/route.ts` — receives the PDFs, extracts, compares, returns JSON
- `lib/extract.ts` — direct PDF input to the Responses API + JSON schema
- `lib/compare.ts` — the comparison rules + field table (match/review/mismatch)
- `lib/types.ts` — shared types
- `lib/shipments.ts`, `lib/results.ts` — localStorage-backed shipment & result storage

## Reliability testing

`scripts/reliability-test.ts` runs the extract+compare pipeline against three
planted-error PDF sets (`../test-data/sets/set-{a,b,c}`, one directory up from
this repo) and reports how often each planted error is detected:

```bash
RUNS=3 npx tsx scripts/reliability-test.ts
```

See `../test-data/README.md` for what each set plants and
`../test-data/reliability-report.md` for the last recorded results.
