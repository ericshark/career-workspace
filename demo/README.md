# Browser demo

A static tour of Career Workspace with fictional data. It shows the real screens from `../ui/src`
and runs the app's own API code in the browser on an in-memory workspace. Changes reset on reload.
The local app does not use this folder.

- `scripts/prepare.mjs` copies the screens and API code into `generated/` (Git-ignored), applies `overrides/`, and reads the setup steps from the repository README.
- `src/demo/seed.ts` holds the sample workspace; `src/demo/examples.ts` holds the example posts and prepared results. No model is called.
- `src/shims/` replaces Node modules.

```sh
cd demo
npm ci
npm run dev            # development
npm run build          # writes out/ and checks it for private data
npm run preview        # serve out/
npm run test:browser   # walk the tour (DEMO_URL=... for a deployed copy)
```

After changing the app, run the build and browser test. `npm run dev` copies the app once at start; restart it to pick up app changes. Package versions shared with `ui/` must match.
