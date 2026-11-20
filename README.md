# Career Workspace

A local app for organizing your job search, keeping track of applications and
recruiting tasks, reviewing roles, and saving career notes. Start with an empty
workspace and add your own data.

![Dashboard showing example application activity](docs/screenshots/dashboard.png)

## Quick start

Install Git and Node.js 24 or newer on Linux, macOS, or Ubuntu in Windows
Subsystem for Linux (WSL 2). Run these commands inside the Linux distribution
when using WSL. On Windows, clone under your Linux home directory for faster I/O.

```sh
git clone https://github.com/ericshark/career-workspace.git
cd career-workspace
./scripts/setup.sh
./scripts/ui.sh
```

Open the URL printed in the terminal, normally
[http://127.0.0.1:3001](http://127.0.0.1:3001). The first start builds the app.
Stop it with **Ctrl+C**, or run `./scripts/ui.sh stop` in another terminal.
Use `./scripts/ui.sh status` to see whether the launcher is running. If the port
is occupied, start with a different one, for example `CAREER_PORT=3100 ./scripts/ui.sh`.

Setup creates an empty tracker and copies starter profile and resume files.
Running it again preserves existing files. Tracking, Actions, Workshop, and
Docs work without an AI connection.

## Connect AI

Open **Apply → Models**. Choose **OpenAI** or **Claude**.

| Connection | Setup | Usage |
| --- | --- | --- |
| OpenAI API key | Copy `ui/.env.example` to `ui/.env.local` and set `OPENAI_API_KEY`. Restart the app. Select **Use OpenAI API key** if a ChatGPT plan was active. | Your OpenAI API account |
| Claude API key | Set `ANTHROPIC_API_KEY` in the same local file, restart, and select **Claude**. | Your Claude Console account |
| ChatGPT plan | Select **OpenAI → Continue with ChatGPT**, authorize plan usage in your browser, and return to Apply. Reopen **Models** to see which connection is active. | Your eligible ChatGPT plan and its limits |

Create keys in the [OpenAI API platform](https://platform.openai.com/api-keys)
or [Claude Console](https://platform.claude.com/settings/keys). Keep them in
`ui/.env.local` and restart after changes. On shared systems run
`chmod 600 ui/.env.local`. If access expires, reconnect. If a model is unavailable,
pick a model your account allows. The app never switches from plan usage to
API billing automatically. You can review or revoke plan permissions from your
ChatGPT settings. [Official ChatGPT sign-in guide](https://developers.openai.com/siwc/token-sharing-open-source)

The original personal workspace used a Codex CLI subscription login and a
Claude Code setup token. This edition uses its own ChatGPT sign-in and Claude
Console API keys. Eligible Claude subscribers can link a Console organization,
[claim API credits](https://platform.claude.com/docs/en/about-claude/api-credits-for-subscribers),
then use a key from that organization. Eligible ChatGPT subscribers can also
[claim OpenAI API credits](https://developers.openai.com/api/docs/guides/chatgpt-api-credits)
and use a project key from the linked organization.

## Add your profile and resume

Review and Tailor judge each job against two files that only you can provide.
Setup creates both as placeholders. They are Git-ignored, so they stay on your
machine and never reach GitHub.

| File | What goes in it | What it drives |
| --- | --- | --- |
| `profile/career.md` | Your background as Markdown: experience, projects, education, skills, and target roles | **Fit** (how well your evidence matches the job), application answers, cover letters, and Tailor |
| `source/tech/resume.tex` | Your resume as LaTeX | **Match** (how well the resume you would send matches the job) |

**Your profile.** Open `profile/career.md` in any editor and replace each
`<!-- … -->` prompt with text under its heading. Write what you did and can
verify: employers and dates, what you personally built, the tools you used, and
real numbers. Leave out anything you cannot back up. The AI is told to use only
these facts and not to invent any. Review and Questions leave out a `Contact`
section if you add one, and Review also skips `Example bullets` and
`Summary Statements`. Tailor sends the whole file, so keep anything private out of it.

**Your resume.** Open `source/tech/resume.tex` and replace each placeholder line
(`Replace this line with…`) inside the existing `\resumeSubheading` and
`\resumeItem` entries. To add a job or project, copy an existing block. Keep the
template's structure so the checks can read it, then build it:

```sh
./scripts/build.sh source/tech/resume.tex --png ui/.cache/png
```

The build must produce exactly one page and an ATS PASS before it writes
`resumes/tech/Resume.pdf`. Open the PNG to check the layout. Review scores
every job against this tech master, and Tailor makes a job-specific copy
without changing it. The `general` and `datacenter` masters in `source/` are
optional extra versions. Resume and PDF tools need Python, TeX Live and Poppler
(see [Resume tools](#resume-tools)).

## Try a job from start to finish

1. **Start on Dashboard.** Check today's count and recruiting updates. You can
   set the timezone and daily or weekly targets in `ui/.env.local` using the
   example settings.
2. **Log a job you already applied to.** In **Apply → Quick Add**, paste a job
   description, optionally add the posting URL, and submit. A fictional
   example is “Backend Engineer at Orchard Systems. Build Python services,
   write integration tests, and improve API reliability.” Quick Add reads the
   text and records the application. It does not submit it to the employer.
   Without AI, add a record from the terminal:

   ```sh
   ./scripts/apps.sh add --company "Orchard Systems" --role "Backend Engineer" --status applied --resume tech
   ```
3. **Manage it in Tracker.** Find the record, open its details, or update the
   status. Use **Undo** immediately after a Quick Add if needed. View activity
   trends on Dashboard.
4. **Review a role before applying.** First add your own information to
   `profile/career.md` and `source/tech/resume.tex`
   ([how](#add-your-profile-and-resume)). Then use **Apply → Review** for Fit
   and Match and **Tailor** for a separate version. Review changed wording and
   the generated PDF before using it. **Apply → Questions** drafts application
   answers and cover letters.
5. **Plan your next steps.** Add an interview or follow-up under **Actions**.
   In **Workshop**, save ideas, turn them into projects, and keep project
   tasks and links together.
6. **Save reference material.** In **Docs**, use **New doc** to type or paste
   Markdown, or **Import file** for a UTF-8 `.md` or `.txt` file or a PDF.
   Search by title. Text notes are editable, and PDFs can be opened or
   downloaded. Imports are copied into your local library.

![Quick Add on the Apply screen](docs/screenshots/apply.png)

![Docs library with a Markdown interview checklist](docs/screenshots/docs.png)

## Resume tools

Tracking and Docs need only Node. To build and tailor resumes on Ubuntu or
WSL, install Python, TeX Live and Poppler. On macOS, install Python, Poppler and
a TeX distribution such as MacTeX. Install dependencies with your platform's
package manager.

```sh
# Ubuntu / WSL
sudo apt install python3 texlive-latex-base texlive-latex-recommended lmodern poppler-utils

# macOS with Homebrew; restart your shell after installing MacTeX
brew install python poppler
brew install --cask mactex-no-gui

# Build your edited master and show its ATS result
./scripts/build.sh source/tech/resume.tex --png ui/.cache/png
```

The starter files show the format. Replace their instructional text before
using the PDFs. A tailored resume must pass the one-page and ATS checks.

## Optional Gmail checks

The app has manual recruiting actions. To run mail-assisted checks, open this
checkout in a desktop agent that can use the bundled skills, execute local
scripts, and access a Gmail connector. Connect your own Gmail account and
create **Job Confirmations**, **Applications Closed**, and **Action Needed**
labels. Start with **Career Check Dry Run** and verify the account and proposed
changes. **Career Check** can organize recruiting mail and update local records.
**Actions Check** can synchronize tasks and **Opportunity Check** can research
a selected recruiter message. These are on-demand desktop workflows.

## Local data and backups

The tracker and history are in `records/`, your profile in `profile/`,
resume sources and outputs in `source/` and `resumes/`, Workshop in
`ui/.workshop/`, and Docs in `.documents/`. Back up those directories to a
location you control. They're Git-ignored. Keep `ui/.env.local` and
`ui/.cache/chatgpt-*.json` private. When you use AI, the selected provider
receives the inputs needed for the chosen feature. Imported Docs are held
locally and stay out of AI requests.

## Troubleshooting

- **Setup fails** — check `node --version` and rerun setup from the repo root.
- **Tailor can't build a PDF** — check `pdflatex`, `pdfinfo`, `pdftotext`, and
  `pdftoppm` are on your shell's path.
- **AI is optional** — the header indicates whether credentials are configured
  locally. The first model call confirms model access and billing.
- **PDF preview is blank** — use **Open PDF** or **Download PDF**.

MIT licensed. See [LICENSE](LICENSE).
