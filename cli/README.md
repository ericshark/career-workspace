# create-career-workspace

Guided setup for [Career Workspace](https://github.com/ericshark/career-workspace), a local app for your job search.

```sh
curl -fsSL https://career-workspace-demo.vercel.app/setup.mjs -o career-setup.mjs
node career-setup.mjs
```

Needs Git and Node.js 24 or newer on Linux, macOS, or Ubuntu in WSL 2. It clones the repository, installs the app with an empty workspace, and can import your background or resume, choose an AI provider, payment route and model, save your API key, install resume tools, and start the app. Every optional step can be skipped. Run it again in the same folder to continue; your files are kept.

It has no dependencies and collects nothing. API keys are saved only to `ui/.env.local`, readable only by you.

Options: `[folder]`, `--yes`, `--no-start`, `--repo`, `--help`.
