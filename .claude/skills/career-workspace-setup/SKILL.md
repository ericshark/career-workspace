---
name: career-workspace-setup
description: Set up or resume setting up a local public Career Workspace, including the app, profile, resume, AI, Gmail checks, and a launch shortcut. Use when asked to set up Career Workspace or finish its onboarding.
---

# Career Workspace Setup

## Open the app

Work from the installed public repository root. Verify it is the public edition and use the local machine where the user wants the app. On Windows, use the Ubuntu WSL environment. If setup is incomplete, run `./scripts/setup.sh`. Start with `node scripts/open-workspace.mjs`. Use the verified URL it prints. If the default port belongs to another app, choose an available port and pass it to the command. If you cannot open a browser, give the verified URL. Ask about optional setup only after the app is reachable, or after explaining a concrete launch blocker.

On a repeat run, check the workspace for the user's existing profile, master, AI connection and launcher before offering missing steps. Use the app's health and Models views to check AI status. Keep existing settings and work unless the user asks to make a specific change.

## Add a profile and resume

Offer a local file path, an attachment you can read, or pasted text. Accept Markdown, text, PDF with readable text, or LaTeX. Extract PDF text locally with `pdftotext` when available. If text cannot be read, ask for a text copy. Offer three choices: format the resume using the bundled layout with its content intact, renew the resume by improving content and layout within the supported template, or defer resume work. The user can also defer the entire step.

Draft `profile/career.md` using the public starter headings and facts supported by the input. Leave unknown details blank and omit unnecessary contact details. Show the draft or diff and ask the user to check it. For a starter profile, write the draft to that local file. For an existing profile, propose a merge and apply it after approval. After their review, ask one batch of relevant optional questions about missing evidence that would improve future reviews, such as target roles, project ownership, scope, or measurable results. Update the profile with their answers only.

For either resume choice, read [the public Resume Guide](../../../docs/resume-guide.md) and follow its draft, validation, and promotion steps. Tell the user where to find the draft and which checks you completed. Keep the existing master until the user approves promotion.

## Connect AI and email

Explain that Quick add, Review, Tailor, and Questions use AI. Offer Continue with ChatGPT, an OpenAI or Claude API key, or Skip. For ChatGPT, guide the user to Apply → Models → Continue with ChatGPT and let them finish in the browser, then confirm connection in Models. For Claude, use a Console API key, including when eligible subscribers fund the key with credits.

For a key, create `ui/.env.local` from `ui/.env.example` with owner-only permissions if absent and link to the local file. Point to OPENAI_API_KEY or ANTHROPIC_API_KEY. Have the user enter the key in their local editor. Keep credentials out of chat and command output. Restart the app after a key change and confirm the provider in Models.

Explain the agent skills separately from the app screens. Recommend Career Check as the entry point for recruiting email and task reconciliation. Explain that it matches messages to applications, updates their local statuses, and tracks follow-ups. Opportunity Check researches a recruiting message and assesses the role and next step. Tailor Resume creates and validates a separate job-specific PDF from a saved job and reports Resume Match before and after. ATS Check tests whether a resume can be parsed in the expected reading order. If the user wants recruiting email checks, follow the README's Optional Gmail checks for the agent in use. Have them connect their own Google account. Offer Career Check Dry Run once the connector is available, show what it would change locally, and get approval before running the write mode. The checks only read Gmail.

## Reopen the app and try it

Offer the shortcut instructions in the README's Reopen Career Workspace section. Use the detected OS, actual checkout path, verified Node path, and working port. On Windows give the WSL distro and exact shortcut target, with Run set to Minimized. On macOS give the Run Shell Script command for Shortcuts. On Linux give a desktop entry or the command for the desktop launcher editor. Show how to bookmark the verified address and how to stop the server.

End with the local URL, setup steps confirmed or deferred, and one first task. Point to Apply → Quick add and Tracker for an already-applied job with AI, or use the terminal example in the README's first-job walkthrough if AI was skipped. To resume, ask for Career Workspace Setup from the workspace folder.
