---
name: ats-check
description: Deterministic ATS parsing test for resumes. Runs automatically inside scripts/build.sh on every resume build; use it directly when the workspace owner asks "is my resume ATS-safe", "run the ATS check", after any resume PDF changes, or to audit all resumes.
---

# /ats-check: will an ATS read this resume correctly?

`scripts/ats_check.py` compares what `pdftotext` extracts from the PDF (roughly what an ATS parser gets) against what the `.tex` source says should be there. The check is deterministic: it makes no model calls and does not score keywords.

## When it runs

- **Every build, automatically.** `scripts/build.sh` runs it after the 1-page check. A **FAIL blocks the build**: the new PDF is not copied into `resumes/`. Never bypass this by copying a PDF by hand.
- **On demand:**
  - one resume: `scripts/ats_check.py source/<category>/resume.tex` (or `source/tailored/<company-role>/resume.tex`)
  - everything: `scripts/ats_check.py --all` (masters + tailored resumes; skips cover letters and hourly)
  - a specific PDF: add `--pdf <file.pdf>`

## What it checks

| Check                                    | Fails when                                                                                                |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Text extracted                           | Fewer than 150 words come out (image-only or broken PDF)                                                  |
| One page                                 | PDF isn't exactly 1 page                                                                                  |
| Name / Email / Phone / Links             | Header values from the `.tex` are missing, or the name isn't in the first lines                           |
| Section headings + "<Section> extracted" | A heading or any word of that section's content is missing                                                |
| Job/project headings                     | A title, organization, or project name is missing                                                         |
| Bullets intact                           | Any `\resumeItem` text isn't present as a contiguous run, or `•` markers are missing                      |
| Dates preserved                          | Any month-year/year from the source is missing                                                            |
| Reading order                            | Name → sections → entries don't come out in source order (e.g. a two-column layout scrambling the stream) |
| No corrupted characters                  | `�`, `(cid:N)`, control or private-use characters, or ligature glyphs (ﬁ ﬂ)                               |
| Unusual symbols (**warning only**)       | Non-ASCII symbols other than dashes, quotes, bullets, and Polish letters                                  |

Output ends with **PASS**, **PASS (with warnings)**, or **FAIL**. Exit code 0 = pass, 1 = fail.

## When it fails

1. Read the `✗` lines. They name the exact missing text, character, or out-of-order item.
2. Fix the `.tex` (never the PDF): usually a stray macro, a special character, an unescaped `%`/`&`, or a layout change that reorders the text stream.
3. Rebuild with `scripts/build.sh`, which re-runs the check. Report the final verdict to the workspace owner.
4. If the check itself looks wrong (a false failure), say so and show the evidence. Don't weaken the check silently.
