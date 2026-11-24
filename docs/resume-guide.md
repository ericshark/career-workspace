# Resume Guide

Keep one approved master for each resume category you use. The default master is `source/tech/resume.tex`, with its PDF in `resumes/tech/Resume.pdf`. Keep job-specific versions separate from the master.

## Create and review a draft

1. Read the original resume and the current master or starter. Put the draft in `source/temp-tech/resume.tex`. Keep the source document and any existing draft unless the owner approves replacing it.
2. For formatting only, carry over the supplied content and place it in the bundled template. For a renewal, improve wording, section order, emphasis, and spacing within the supported LaTeX template. Preserve the template commands used by Review and Tailor. Use only supported facts and ask the owner about gaps.
3. Run `./scripts/build.sh source/temp-tech/resume.tex --png ui/.cache/png`. Require a one-page PDF and ATS pass. Inspect the extracted text for reading order and the PNG for clipping and legibility. If tools are missing, use the README's Resume tools section or leave the draft for later.
4. Show the owner the draft PDF, the important changes, and any open questions. Get approval before promoting the draft.

## Back up and promote

Before replacing a user-edited master, preserve its source and matching PDF. If the PDF is missing, build the existing master first. If it cannot be built, leave the approved draft in place until the owner resolves the backup. A fresh, unedited starter with no PDF can be replaced without a snapshot.

Create a new directory under `resumes/backups/tech/` named `YYYY-MM-DD_NN` using the owner's local date and the next numeric suffix across existing snapshots. Use exclusive directory creation and retry with the next suffix if it is already taken. Copy the current source and PDF into it as `resume.tex` and `Resume.pdf`. Compare both copies with the originals before editing the master. Preserve all existing snapshots.

Copy the approved source to the master path and rebuild it with the same command used for the draft, substituting the master path. If the final build fails, restore the prior source and prior PDF, or remove the newly created PDF if there was none. Report the draft, master, and snapshot locations.

## Restore or tailor

To restore, back up the current master first. Restore the selected snapshot's source and PDF together, rebuild, and check the ATS text and render. Report which snapshot was restored.

For a specific job, use Apply → Review → Tailor or the Tailor Resume agent skill. Use the saved job review and the facts in the career profile. Review the resulting PDF and changes before sending it.
