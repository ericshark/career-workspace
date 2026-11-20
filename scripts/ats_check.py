#!/usr/bin/env python3
"""Deterministic ATS parsing check for a compiled resume.

Compares what `pdftotext` extracts from the PDF (roughly what an ATS parser
sees) against what the .tex source says should be there:

  * text extracts at all, and the PDF is exactly one page
  * name, email, phone, and links come through
  * every section heading, job/project heading, and bullet survives intact
  * every date in the source is preserved
  * sections and entries come out in the source's reading order
  * no corrupted / unmappable characters (warns on unusual symbols)

Usage:
  scripts/ats_check.py source/tech/resume.tex             # checks resumes/tech/...pdf
  scripts/ats_check.py source/tech/resume.tex --pdf X.pdf # check a specific PDF
  scripts/ats_check.py --all                              # every resume under source/ except hourly

Exit code 0 = PASS (warnings allowed), 1 = FAIL, 2 = usage error.
"""

import argparse
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PDF_NAME = "Resume.pdf"

# Resume macros from Jake's template → how many brace arguments they take.
HEADING_MACROS = {
    "resumeSubheading": 4,  # title, date, org, location
    "resumeSubSubheading": 2,
    "resumeProjectHeading": 2,  # name | stack, date
}
MONTHS = (
    "January|February|March|April|May|June|July|August|September|"
    "October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec"
)
DATE_RE = re.compile(rf"\b(?:{MONTHS})\.?\s+\d{{4}}\b|\b(?:19|20)\d{{2}}\b")
# Non-ASCII characters that ATS parsers handle fine (dashes, quotes, bullets,
# Polish letters). Anything else non-ASCII is reported as a warning.
ALLOWED_NON_ASCII = set("∼–—‘’“”•…éóąćęłńśźżĄĆĘŁŃÓŚŹŻ")


# ---------------------------------------------------------------------------
# LaTeX side: what the resume *should* contain
# ---------------------------------------------------------------------------

def strip_comments(tex: str) -> str:
    # Drop everything after an unescaped %, line by line.
    return "\n".join(re.sub(r"(?<!\\)%.*", "", line) for line in tex.splitlines())


def read_group(s: str, i: int):
    """Return (content, end_index) of the {...} group starting at s[i] == '{'."""
    depth = 0
    for j in range(i, len(s)):
        if s[j] == "{" and (j == 0 or s[j - 1] != "\\"):
            depth += 1
        elif s[j] == "}" and s[j - 1] != "\\":
            depth -= 1
            if depth == 0:
                return s[i + 1:j], j + 1
    raise ValueError("unbalanced braces")


def macro_args(body: str, name: str, nargs: int):
    """Yield (position, [args]) for every use of \\name{..}{..}... in body."""
    for m in re.finditer(rf"\\{name}(?![a-zA-Z])", body):
        i, args = m.end(), []
        for _ in range(nargs):
            while i < len(body) and body[i].isspace():
                i += 1
            if i >= len(body) or body[i] != "{":
                break
            arg, i = read_group(body, i)
            args.append(arg)
        if len(args) == nargs:
            yield m.start(), args


def detex(s: str) -> str:
    """Convert a LaTeX snippet to the plain text it renders as."""
    s = re.sub(r"\\href\{[^}]*\}", "", s)  # keep the link text, drop the URL
    s = re.sub(r"\\(?:vspace|hspace)\*?\{[^}]*\}", "", s)
    s = re.sub(r"\\begin\{[^}]*\}(\[[^\]]*\])?|\\end\{[^}]*\}", " ", s)
    replacements = [
        (r"$\sim$", "∼"), (r"$|$", "|"), (r"\&", "&"), (r"\%", "%"),
        (r"\$", "$"), (r"\#", "#"), (r"\_", "_"), ("---", "—"), ("--", "–"),
        ("``", "“"), ("''", "”"), (r"\\", " "), ("~", " "),
    ]
    for a, b in replacements:
        s = s.replace(a, b)
    s = re.sub(r"\\[a-zA-Z]+\*?", " ", s)  # remaining commands (\textbf, \small…)
    # Braces become spaces so adjacent macro args ({Orchard Systems}{Remote}) stay separate words.
    s = s.replace("{", " ").replace("}", " ").replace("$", "")
    return re.sub(r"\s+", " ", s).strip()


def parse_tex(path: Path) -> dict:
    tex = strip_comments(path.read_text())
    body = tex.split(r"\begin{document}", 1)[1].split(r"\end{document}", 1)[0]

    # Header = everything before the first \section.
    first_section = body.find(r"\section")
    header = body[:first_section]
    name_m = re.search(r"\\scshape\s+([^}\\]+)", header)
    email_m = re.search(r"mailto:([^}]+)\}", header)
    phone_m = re.search(r"\d{3}[-.\s]\d{3}[-.\s]\d{4}", header)
    links = [detex(t) for _, (_, t) in macro_args(header, "href", 2)]

    sections = [(pos, detex(a[0])) for pos, a in macro_args(body, "section", 1)]

    # Entry headings in source order: the left-column texts (title/org or
    # project name) are what reading order is judged on.
    entries = []
    for macro, n in HEADING_MACROS.items():
        for pos, args in macro_args(body, macro, n):
            left = [detex(args[0])] + ([detex(args[2])] if n == 4 else [])
            # For projects, the anchor is the name before " | stack".
            left = [t.split(" | ")[0] for t in left]
            entries.append((pos, left, [detex(a) for a in args]))
    entries.sort()

    bullets = [detex(a[0]) for _, a in macro_args(body, "resumeItem", 1)]

    # Per-section plain text, for "Skills extracted", "Experience extracted"…
    bounds = [p for p, _ in sections] + [len(body)]
    section_text = {
        title: detex(body[bounds[k]:bounds[k + 1]].split("}", 1)[1])
        for k, (_, title) in enumerate(sections)
    }

    return {
        "name": name_m.group(1).strip() if name_m else None,
        "email": email_m.group(1).strip() if email_m else None,
        "phone": phone_m.group(0) if phone_m else None,
        "links": [l for l in links if "@" not in l],
        "sections": [t for _, t in sections],
        "section_text": section_text,
        "entries": entries,
        "bullets": bullets,
        "dates": sorted(set(DATE_RE.findall(detex(body)))),
        # Sections and entry headings merged in source order (reading order).
        "order": [items for _, items in sorted(
            [(pos, [title]) for pos, title in sections]
            + [(pos, lefts) for pos, lefts, _ in entries])],
    }


# ---------------------------------------------------------------------------
# PDF side: what an ATS actually gets
# ---------------------------------------------------------------------------

def squash(s: str) -> str:
    """Normalize for containment checks: lowercase, no whitespace, unify dashes.

    Whitespace is dropped so line wraps in the PDF don't break matches.
    """
    s = unicodedata.normalize("NFKC", s).lower()
    s = s.replace("–", "-").replace("—", "-").replace("∼", "~")
    # LaTeX turns ' and `` '' into curly quotes in the PDF.
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", "", s)


class Report:
    def __init__(self):
        self.lines, self.failed, self.warned = [], False, False

    def ok(self, msg):
        self.lines.append(f"✓ {msg}")

    def fail(self, msg, details=()):
        self.failed = True
        self.lines.append(f"✗ {msg}")
        self.lines += [f"    {d}" for d in details]

    def warn(self, msg, details=()):
        self.warned = True
        self.lines.append(f"! {msg}")
        self.lines += [f"    {d}" for d in details]


def check(tex_path: Path, pdf_path: Path) -> Report:
    r = Report()
    exp = parse_tex(tex_path)

    raw = subprocess.run(["pdftotext", str(pdf_path), "-"],
                         capture_output=True, text=True)
    text = raw.stdout
    pages = subprocess.run(["pdfinfo", str(pdf_path)],
                           capture_output=True, text=True).stdout
    page_count = re.search(r"^Pages:\s+(\d+)", pages, re.M)

    # 1. Extraction + page count
    words = len(text.split())
    if raw.returncode != 0 or words < 150:
        r.fail(f"Text extraction ({words} words)", ["PDF text is missing or unreadable"])
        return r
    r.ok(f"Text extracted ({words} words)")
    if page_count and page_count.group(1) == "1":
        r.ok("One page")
    else:
        r.fail(f"One page (found {page_count.group(1) if page_count else '?'})")

    flat = squash(text)
    head = squash("\n".join(text.strip().splitlines()[:4]))

    # 2. Contact block
    if exp["name"] and squash(exp["name"]) in head:
        r.ok("Name extracted")
    else:
        r.fail("Name extracted", [f"expected '{exp['name']}' in the first lines"])
    for label, value in (("Email", exp["email"]), ("Phone", exp["phone"])):
        if value is None:
            r.warn(f"{label} not found in the .tex header")
        elif squash(value) in flat:
            r.ok(f"{label} extracted")
        else:
            r.fail(f"{label} extracted", [f"missing: {value}"])
    missing_links = [l for l in exp["links"] if squash(l) not in flat]
    if missing_links:
        r.fail("Links extracted", missing_links)
    elif exp["links"]:
        r.ok(f"Links extracted ({len(exp['links'])})")

    # 3. Sections: heading present and all of its words present
    missing_heads = [s for s in exp["sections"] if squash(s) not in flat]
    if missing_heads:
        r.fail("Section headings", missing_heads)
    else:
        r.ok(f"Section headings ({', '.join(exp['sections'])})")

    pdf_words = set(re.findall(r"[a-z0-9]+", unicodedata.normalize("NFKC", text).lower()))
    # Words split across a hyphenated line break would appear as two halves.
    pdf_words |= set(re.findall(r"[a-z0-9]+", re.sub(r"-\n", "", text.lower())))
    for title, sec_text in exp["section_text"].items():
        lost = sorted({w for w in re.findall(r"[a-z0-9]+", sec_text.lower())} - pdf_words)
        if lost:
            r.fail(f"{title} extracted", [f"words missing: {', '.join(lost[:15])}"])
        else:
            r.ok(f"{title} extracted")

    # 4. Entries (jobs/projects) and bullets intact
    missing_entries = [e for _, lefts, _ in exp["entries"] for e in lefts
                       if squash(e) not in flat]
    if missing_entries:
        r.fail("Job/project headings", missing_entries)
    else:
        r.ok(f"Job/project headings ({len(exp['entries'])})")

    mangled = [b for b in exp["bullets"] if squash(b) not in flat]
    bullet_marks = text.count("•")
    if mangled:
        r.fail(f"Bullets intact ({len(exp['bullets']) - len(mangled)}/{len(exp['bullets'])})",
               [b[:90] + ("…" if len(b) > 90 else "") for b in mangled])
    elif bullet_marks < len(exp["bullets"]):
        r.fail("Bullet markers", [f"{bullet_marks} '•' found for {len(exp['bullets'])} bullets"])
    else:
        r.ok(f"Bullets intact ({len(exp['bullets'])})")

    # 5. Dates
    lost_dates = [d for d in exp["dates"] if squash(d) not in flat]
    if lost_dates:
        r.fail("Dates preserved", lost_dates)
    else:
        r.ok(f"Dates preserved ({len(exp['dates'])})")

    # 6. Reading order: name → sections and entry headings in source order.
    anchors = [exp["name"]] if exp["name"] else []
    for items in exp["order"]:
        anchors += items
    cursor, out_of_order = 0, []
    for a in anchors:
        idx = flat.find(squash(a), cursor)
        if idx == -1:
            if squash(a) in flat:
                out_of_order.append(a)
            continue  # missing text is already reported above
        cursor = idx + len(squash(a))
    if out_of_order:
        r.fail("Reading order correct", [f"appears earlier than expected: {a}" for a in out_of_order])
    else:
        r.ok("Reading order correct")

    # 7. Characters
    bad = {c for c in text if c == "\ufffd"
           or unicodedata.category(c) in ("Co", "Cs")
           or (unicodedata.category(c) == "Cc" and c not in "\n\t\f\r")}
    ligatures = {c for c in text if c in "ﬀﬁﬂﬃﬄ"}
    if "(cid:" in text or bad or ligatures:
        details = [f"U+{ord(c):04X} {unicodedata.name(c, '?')}" for c in sorted(bad | ligatures)]
        if "(cid:" in text:
            details.append("'(cid:N)' glyphs: a font has no Unicode mapping")
        r.fail("No corrupted characters", details)
    else:
        r.ok("No corrupted characters")
    odd = sorted({c for c in text if ord(c) > 127 and c not in ALLOWED_NON_ASCII})
    if odd:
        r.warn("Unusual symbols (most ATS read them, but plain ASCII is safest)",
               [f"'{c}' U+{ord(c):04X} {unicodedata.name(c, '?')}" for c in odd])
    return r


def pdf_for(tex: Path) -> Path:
    # source/<sub>/<file>.tex → resumes/<sub>/Resume.pdf
    rel = tex.resolve().relative_to(ROOT / "source")
    return ROOT / "resumes" / rel.parent / PDF_NAME


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("tex", nargs="*", help="resume .tex file(s) under source/")
    ap.add_argument("--pdf", help="PDF to check (default: matching file in resumes/)")
    ap.add_argument("--all", action="store_true", help="check every resume under source/ except hourly")
    args = ap.parse_args()

    texes = [Path(t) if Path(t).is_absolute() else ROOT / t for t in args.tex]
    if args.all:
        # Only resume.tex: cover-letter.tex would be checked against the resume PDF and always fail.
        # Hourly is an unmaintained throwaway, so its failures would be noise.
        texes += sorted(
            t for t in (ROOT / "source").rglob("resume.tex")
            if t.relative_to(ROOT / "source").parts[0] != "hourly"
        )
    if not texes or (args.pdf and len(texes) != 1):
        ap.print_usage(sys.stderr)
        return 2

    status = 0
    for tex in texes:
        pdf = Path(args.pdf) if args.pdf else pdf_for(tex)
        shown = tex.relative_to(ROOT) if tex.resolve().is_relative_to(ROOT) else tex
        print(f"ATS PARSING: {shown}")
        if not pdf.exists():
            print(f"✗ PDF not found: {pdf}\n\nFAIL\n")
            status = 1
            continue
        rep = check(tex, pdf)
        print("\n".join(rep.lines))
        verdict = "FAIL" if rep.failed else ("PASS (with warnings)" if rep.warned else "PASS")
        print(f"\n{verdict}\n")
        status |= rep.failed
    return status


if __name__ == "__main__":
    sys.exit(main())
