# Demo deployment

The browser demo in `demo/` is live. The full app runs locally and is not deployed.

- **URL:** https://career-workspace-demo.vercel.app
- **Host:** Vercel project `career-workspace-demo`, free tier, no recurring cost. No custom domain.
- **Architecture:** Browser → Vercel static files. There is no server code, database, account, AI or Gmail connection. The app's screens and API code run in the browser on an in-memory workspace of fictional data.

## Workflow

- Pushing `main` on `ericshark/career-workspace` deploys production. Other branches get previews.
- Vercel uses `demo/` as its root directory and reads the rest of the repository at build time. `demo/vercel.json` sets the install, build, skip rule and security headers. Builds are skipped when `demo/`, `ui/`, `cli/`, `prompts/` and `README.md` are unchanged.
- The build fails if a README section used by the How to set it up page is missing, if shared package versions differ from `ui/`, or if the output contains private-looking data.
- Check status and logs in the Vercel project, or with `vercel inspect <url> --logs`. Roll back with `vercel rollback` or the dashboard. There are no migrations.

## Setup command

`cli/` is the guided setup. Each demo build publishes it as one file at `/setup.mjs`, from `main`. npm 12 refuses to run packages from a URL, so Node runs the file directly. `cli/package.json` is ready for npm as `create-career-workspace`, but it is not published there. Raise its version when it changes.

## Configuration

No environment variables or secrets. Node 24.

## Maintenance

After changing the app, run `npm run build` and `npm run test:browser` in `demo/`. Check the live copy with `DEMO_URL=https://career-workspace-demo.vercel.app npm run test:browser`. If the build reports version drift, match `demo/package.json` to `ui/package.json` and run `npm install`. Vercel's toolbar on previews is blocked by the content security policy, so run the live check against production.

Known limits: edits reset on reload, only the bundled example posts have results, and resume building, Tailor, AI sign-in, Gmail checks, file import and the Workshop Dev tab are local only.
