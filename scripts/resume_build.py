#!/usr/bin/env python3
"""Build only through build.sh: isolated TeX, explicit gates, staged publication."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
PDF_NAME = 'Resume.pdf'
LETTER = 'cover-letter.tex'
LETTER_PDF = 'Cover_Letter.pdf'
LETTER_CATEGORIES = ('tech', 'general', 'new-tech')


def safe_path(p, namespace=None):
    """Reject redirection, including ancestors that redirect back into the workspace."""
    p = Path(os.path.abspath(p))
    real = p.resolve()
    if real != p or not real.is_relative_to(ROOT):
        raise ValueError(f'unsafe canonical path: {p}')
    if namespace and not real.is_relative_to(ROOT / namespace):
        raise ValueError(f'path outside {namespace}: {p}')
    return real


def preflight(tex):
    code = re.sub(r'(?<!\\)%.*', '', tex)
    # TeX decodes ^^ before tokenizing; refuse it rather than checking the misleading spelling.
    if '^^' in code:
        raise ValueError('forbidden TeX character encoding (^^)')
    code = re.sub(r'\\input\s*\{glyphtounicode\}', '', code)
    if re.search(r'\\(?:usepackage|documentclass)\s*(?:\[[^\]]*\])?\s*\{[^}]*(?:/|\\|\.\.)', code):
        raise ValueError('external package/class path')
    forbidden = r'\\(?:input|include|includeonly|openin|openout|read|readline|write|immediate|catcode|csname|special|InputIfFileExists|IfFileExists|directlua|def|gdef|edef|xdef|let|newenvironment|renewenvironment|endinput|phantom|hphantom|vphantom|usepackagefile|verbatiminput|lstinputlisting|includegraphics|pdfobj|pdffiledump|pdfximage|pdfmdfivesum|pdffilesize|scantokens|endlinechar|everyeof)(?![a-zA-Z])'
    body = code.split(r'\begin{document}', 1)[-1]
    if re.search(r'\\(?:newcommand|renewcommand|def|gdef|edef|xdef|let|if[a-zA-Z]*)\b', body):
        raise ValueError('dynamic or hidden document content')
    if re.search(r'\\(?:textcolor|color)\s*\{white\}', body):
        raise ValueError('hidden white document text')
    hit = re.search(forbidden, code)
    if re.search(r"\\[^A-Za-z\s{}]*input", code):
        raise ValueError("forbidden internal input primitive")
    if hit:
        raise ValueError(f'forbidden TeX command: {hit.group()}')


def checked(argv, **kwargs):
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **kwargs)
    if result.returncode:
        raise RuntimeError(f'{argv[0]} failed ({result.returncode}):\n{result.stdout.decode(errors="replace")}')
    return result.stdout.decode(errors='replace')


def build(target, png, text, staging=False):
    if staging:
        tex = safe_path(ROOT / target, 'ui/.cache/tailor-scratch')
        rel = tex.relative_to(ROOT)
        if not re.fullmatch(r'ui/\.cache/tailor-scratch/[A-Za-z0-9-]+/resume\.tex', str(rel)):
            raise ValueError('staging input must be a job-local candidate')
        sub = Path('candidate')
        out = safe_path(tex.parent / 'artifacts', 'ui/.cache/tailor-scratch')
        # Caller names the job directory; staging never writes elsewhere or publishes a resume.
        if png and safe_path(Path(png) if Path(png).is_absolute() else ROOT / png) != tex.parent:
            raise ValueError('staging PNG directory must be the candidate job directory')
        pngdir = out
    else:
        tex = safe_path(ROOT / target, 'source')
        rel = tex.relative_to(ROOT / 'source')
        if len(rel.parts) < 2 or rel.suffix != '.tex':
            raise ValueError('expected source/<category>/resume.tex')
        sub = rel.parent
        letter = rel.name == LETTER
        if letter and (len(rel.parts) != 2 or rel.parts[0] not in LETTER_CATEGORIES):
            raise ValueError('cover letters live at source/<tech|general|new-tech>/cover-letter.tex')
        if not letter and rel.name != 'resume.tex':
            raise ValueError('expected source/<category>/resume.tex')
        if sub.parts[0] == 'tailored' and (len(sub.parts) != 2 or not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', sub.parts[1])):
            raise ValueError('invalid tailored namespace')
        out = safe_path(ROOT / 'resumes' / sub, 'resumes')
        pngdir = safe_path(Path(png) if Path(png).is_absolute() else ROOT / png) if png else None
    letter = not staging and tex.name == LETTER
    destination = safe_path(out / (LETTER_PDF if letter else PDF_NAME))
    source = tex.read_bytes()
    preflight(source.decode())
    for tool in ('pdflatex', 'pdfinfo', 'pdftotext', 'pdftoppm' if pngdir else 'python3'):
        if not shutil.which(tool):
            raise RuntimeError(f'missing tool: {tool}')
    print(f'── {tex.relative_to(ROOT)}', flush=True)
    # Never compile in the repository or inherit token/config/TEXINPUTS variables.
    with tempfile.TemporaryDirectory(prefix='resume-build.') as scratch:
        work = Path(scratch)
        (work / 'resume.tex').write_bytes(source)
        env = {'PATH': os.environ.get('PATH', '/usr/bin:/bin'), 'HOME': scratch,
               'LANG': 'C.UTF-8', 'openin_any': 'p', 'openout_any': 'p', 'shell_escape': 'f'}
        for pass_number in range(2):
            # Instrument the ordinary second pass; the measured PDF is the validated PDF.
            if pass_number == 1:
                fill_tex = source.decode().replace(r'\begin{document}', r'\AtEndDocument{\par\typeout{FILL \the\pagetotal\space OF \the\pagegoal}}' + '\n' + r'\begin{document}', 1)
                (work / 'resume.tex').write_text(fill_tex)
            preflight((work / 'resume.tex').read_text())
            checked(['pdflatex', '-no-shell-escape', '-interaction=nonstopmode', '-halt-on-error', 'resume.tex'], cwd=work, env=env)
        pdf = work / 'resume.pdf'
        if not pdf.is_file() or not pdf.stat().st_size:
            raise RuntimeError('compiler produced no PDF')
        info = checked(['pdfinfo', str(pdf)], env=env)
        if not re.search(r'^Pages:\s+1\s*$', info, re.M):
            raise RuntimeError('page count must be exactly 1')
        print('✓ 1 page', flush=True)
        warnings = [s for s in (work / 'resume.log').read_text(errors='replace').splitlines()
                    if re.search(r'Overfull|Underfull \\hbox|undefined|Missing character|LaTeX Warning|Package .* Warning', s)
                    and not re.search(r'OT1/cmr/bx/sc|footskip is too small|rerunfilecheck', s)]
        print('! warnings:\n' + '\n'.join('    ' + s for s in sorted(set(warnings))) if warnings else '✓ no important warnings')
        if letter:
            # A letter has no resume sections; require readable text that carries the contact line.
            letter_text = checked(['pdftotext', '-layout', str(pdf), '-'], env=env)
            if not re.search(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', letter_text) or len(letter_text.split()) < 4:
                raise RuntimeError('cover letter text is missing the name/contact line')
            print('✓ letter text extracts with contact line')
        else:
            ats = checked([sys.executable, str(ROOT / 'scripts/ats_check.py'), str(work / 'resume.tex'), '--pdf', str(pdf)], env=env)
            if not re.search(r'^PASS(?: \(with warnings\))?$', ats, re.M):
                raise RuntimeError('ATS check did not PASS')
            print(ats, end='')
        fill = re.search(r'^FILL ([\d.]+)pt OF ([\d.]+)pt', (work / 'resume.log').read_text(errors='replace'), re.M)
        if not fill or float(fill[2]) <= 0:
            raise RuntimeError('page fill measurement failed')
        print(f'  fill: {100 * float(fill[1]) / float(fill[2]):.0f}% of the page')
        if tex.read_bytes() != source:
            raise RuntimeError('source changed during compilation')
        # Render and stage all requested output before replacing the old, valid PDF.
        staged_png = None
        if pngdir:
            pngdir.mkdir(parents=True, exist_ok=True)
            staged_png = work / 'render.png'
            checked(['pdftoppm', '-r', '70', '-png', '-singlefile', str(pdf), str(work / 'render')], env=env)
            if not staged_png.is_file() or not staged_png.stat().st_size:
                raise RuntimeError('PNG rendering produced no image')
        visible = checked(['pdftotext', '-layout', str(pdf), '-'], env=env) if text or staging else None
        if text:
            print('── ATS text\n' + visible)
        outputs = {destination: pdf.read_bytes()}
        if staged_png:
            pngdest = safe_path(pngdir / ('-'.join(sub.parts) + ('-cover-letter' if letter else '') + '.png'))
            outputs[pngdest] = staged_png.read_bytes()
        if staging:
            outputs[safe_path(out / 'visible.txt')] = visible.encode()
        # Stage a matched PDF/render/text set. Restore prior outputs if any publication step fails.
        previous = {}
        temporary = []
        try:
            for dest, data in outputs.items():
                dest.parent.mkdir(parents=True, exist_ok=True)
                previous[dest] = dest.read_bytes() if dest.exists() else None
                with tempfile.NamedTemporaryFile(dir=dest.parent, prefix='.resume-', delete=False) as f:
                    stage = Path(f.name)
                temporary.append((stage, dest))
                if dest == destination:
                    shutil.copyfile(pdf, stage)
                else:
                    stage.write_bytes(data)
                if stage.read_bytes() != data:
                    raise RuntimeError('staged copy differs from validated artifact')
            if tex.read_bytes() != source:
                raise RuntimeError('source changed during compilation')
            for stage, dest in temporary:
                safe_path(dest)
                os.replace(stage, dest)
                if dest.read_bytes() != outputs[dest]:
                    raise RuntimeError('published output differs from validated artifact')
            print(f'✓ wrote {destination.relative_to(ROOT)}', flush=True)
            if staged_png:
                print(f'✓ render: {pngdest}', flush=True)
        except Exception:
            for dest, data in previous.items():
                if data is None:
                    dest.unlink(missing_ok=True)
                else:
                    dest.write_bytes(data)
            raise
        finally:
            for stage, _ in temporary:
                stage.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('targets', nargs='*')
    parser.add_argument('--all', action='store_true')
    parser.add_argument('--staging', action='store_true')
    parser.add_argument('--png', default='')
    parser.add_argument('--no-text', action='store_true')
    args = parser.parse_args()
    if args.staging and (args.all or len(args.targets) != 1):
        parser.error('staging requires exactly one candidate and cannot use --all')
    targets = args.targets + (['source/' + c + '/resume.tex' for c in ('tech', 'general', 'datacenter')] if args.all else [])
    if not targets:
        parser.error('a source path or --all is required')
    failed = False
    for target in targets:
        try:
            build(target, args.png, not args.no_text, args.staging)
        except (OSError, ValueError, RuntimeError) as e:
            print(f'✗ {e}', file=sys.stderr)
            failed = True
    return int(failed)


if __name__ == '__main__':
    sys.exit(main())
