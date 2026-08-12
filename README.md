# TradeLynk Web (MVP)

Upload a Commercial Invoice, Packing List and Bill of Lading as PDFs. The
server sends each PDF directly to OpenAI (gpt-4.1-mini, via the Responses API
`input_file` item), extracts the fixed 15-field set, and runs the six
consistency rules from the Python spike. The results page shows the issues and
a field-by-field comparison table.

## Run it

```bash
npm install
cp .env.local.example .env.local   # then add OPENAI_API_KEY
npm run dev                        # http://localhost:3000
```

The three sample PDFs live in `../Document/filled/` and can be dragged straight
into the upload page. The expected result for those files is:

- 🔴 Consignee differs across documents (GmbH vs Gmbh, looks like a typo)
- 🔴 Package count does not match (1 wooden crate vs 2 packages)
- 🟠 Gross weight does not match (18.5 kg vs 18.0 kg)
- 🟠 Painting support material does not match (linen vs canvas)

## No API key? Use sample data

For UI development without calling OpenAI, set `EXTRACTION_MODE=mock` in
`.env.local`. The API then returns the bundled sample extraction
(`lib/mockData.ts`) instead of calling the model.

## Layout

- `app/page.tsx` — upload page (three drag-and-drop zones)
- `app/results/page.tsx` — results page (reads `sessionStorage`)
- `app/api/check/route.ts` — receives the PDFs, extracts, compares, returns JSON
- `lib/extract.ts` — direct PDF input to the Responses API + JSON schema
- `lib/compare.ts` — the six comparison rules + field table
- `lib/types.ts` — shared types
