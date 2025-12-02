This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## OpenAI GPT endpoint (API)

- Path: `POST /api/GPT`
- Payload shape:
  ```json
  {
    "file": {
      "path": "src/app/code.ts",
      "language": "ts",
      "content": "// file contents"
    }
  }
  ```
- Responses:
  - Success: `{ "ok": true, "findings": [...], "summary": { file, counts } }`
  - Failure: `{ "ok": false, "error": "message" }` with an HTTP status (400 for missing/invalid payload, otherwise propagated from the analyzer or 500).
- Environment: requires `OPENAI_API_KEY` (and optionally `ANTHROPIC_API_KEY` for Claude in the shared analyzer module).

## GPT endpoint metrics

Use the `npm run metrics` script to score the `/api/GPT` endpoint against the fixtures in `evaluations/fixtures.json`.

1. Ensure `OPENAI_API_KEY` is set and run `npm run dev` so the endpoint is reachable on `http://localhost:3000`.
2. In a separate terminal run `npm run metrics`. The script will:
   - send each fixture file (see `src/app/codeFiles_With_Vuln_Examples/`) to `/api/GPT`,
   - validate responses with the shared Zod schema,
   - compare results with the expected findings, and
   - print per-fixture precision/recall plus aggregate Precision/Recall/F1.

Environment overrides:

- `GPT_EVAL_ENDPOINT` - point to a deployed endpoint instead of `http://localhost:3000/api/GPT`.
- `GPT_EVAL_FIXTURES` - path to a custom fixtures JSON file.

Add more scenarios by appending to `evaluations/fixtures.json` (each entry defines the file path, language, and expected findings).

## GPT endpoint tests

Targeted unit tests for the endpoint live in `src/app/unitTests/gpt-endpoint.test.ts`. They cover:
- Missing payload returns HTTP 400 with an error body.
- Successful analyzer output is returned unchanged with HTTP 200.
- Analyzer `AnalysisError` status and message are propagated to the response.

Run the tests (uses Node’s built-in `node:test` via tsx):

```bash
npx tsx --test src/app/unitTests/gpt-endpoint.test.ts
```

The test file sets dummy `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` values so it does not hit real APIs.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
