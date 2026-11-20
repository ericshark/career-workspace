#!/usr/bin/env python3
"""Offline regression tests: real driver gates, fake tools, temporary workspace only."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import subprocess
import shutil

spec = importlib.util.spec_from_file_location('driver', Path(__file__).with_name('resume_build.py'))
driver = importlib.util.module_from_spec(spec)
spec.loader.exec_module(driver)


class BuildSafety(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='career-build-test.')
        self.root = Path(self.temp.name).resolve()
        self.original = driver.ROOT
        driver.ROOT = self.root
        self.tex = self.root / 'source/tailored/acme/resume.tex'
        self.tex.parent.mkdir(parents=True)
        self.tex.write_text(r'\input{glyphtounicode}\begin{document}Truth\end{document}')
        self.pdf = self.root / 'resumes/tailored/acme/Resume.pdf'
        self.pdf.parent.mkdir(parents=True)
        self.pdf.write_bytes(b'previous-valid-output')
        self.calls = []

    def tearDown(self):
        driver.ROOT = self.original
        self.temp.cleanup()

    def tool(self, argv, **opts):
        self.calls.append((argv, opts))
        cwd = Path(opts.get('cwd', self.root))
        if argv[0] == 'pdflatex':
            job = Path(argv[-1]).stem
            (cwd / (job + '.pdf')).write_bytes(b'validated-pdf')
            (cwd / (job + '.log')).write_text('FILL 640.0pt OF 700.0pt\n')
        if argv[0] == 'pdfinfo': return 'Pages: 1\n'
        if argv[0] == 'pdftoppm': Path(argv[-1] + '.png').write_bytes(b'png')
        if 'ats_check.py' in ' '.join(argv): return 'PASS\n'
        return ''

    def run_build(self):
        with patch.object(driver, 'checked', side_effect=self.tool), patch.object(driver.shutil, 'which', return_value='/installed/tool'):
            driver.build(str(self.tex), str(self.root / 'ui/.cache/png'), False)

    def test_success_uses_isolated_copy_and_scrubbed_environment(self):
        self.run_build()
        self.assertEqual(self.pdf.read_bytes(), b'validated-pdf')
        compilation = [opts for argv, opts in self.calls if argv[0] == 'pdflatex']
        self.assertEqual(len(compilation), 2)
        self.assertTrue(all(opts['cwd'] != self.tex.parent for opts in compilation))
        self.assertTrue(all(opts['env']['openin_any'] == 'p' for opts in compilation))
        self.assertTrue(all('TEXINPUTS' not in opts['env'] and 'CLAUDE_CODE_OAUTH_TOKEN' not in opts['env'] for opts in compilation))
        self.assertTrue(all('-no-shell-escape' in argv for argv, _ in self.calls if argv[0] == 'pdflatex'))

    def test_all_required_failures_preserve_existing_output(self):
        for stage in ('pdflatex', 'pdfinfo', 'ats_check.py', 'pdftoppm'):
            def failing(argv, **opts):
                if stage in ' '.join(argv): raise RuntimeError('requested failure')
                return self.tool(argv, **opts)
            with self.subTest(stage=stage), patch.object(driver, 'checked', side_effect=failing), patch.object(driver.shutil, 'which', return_value='/tool'):
                with self.assertRaises(RuntimeError): driver.build(str(self.tex), str(self.root / 'ui/.cache/png'), False)
                self.assertEqual(self.pdf.read_bytes(), b'previous-valid-output')
        with patch.object(driver, 'checked', side_effect=self.tool), patch.object(driver.shutil, 'which', return_value='/tool'), patch.object(driver.shutil, 'copyfile', side_effect=OSError('copy failure')):
            with self.assertRaises(OSError): driver.build(str(self.tex), '', False)
            self.assertEqual(self.pdf.read_bytes(), b'previous-valid-output')

    def test_missing_tool_and_output_creation_fail(self):
        with patch.object(driver.shutil, 'which', return_value=None):
            with self.assertRaises(RuntimeError): driver.build(str(self.tex), '', False)
        self.pdf.unlink(); self.pdf.parent.rmdir(); self.pdf.parent.write_text('blocked output')
        with patch.object(driver, 'checked', side_effect=self.tool), patch.object(driver.shutil, 'which', return_value='/tool'):
            with self.assertRaises(OSError): driver.build(str(self.tex), '', False)

    def test_staging_keeps_candidate_outputs_job_local(self):
        candidate = self.root / 'ui/.cache/tailor-scratch/job-123/resume.tex'
        candidate.parent.mkdir(parents=True)
        candidate.write_bytes(self.tex.read_bytes())
        with patch.object(driver, 'checked', side_effect=self.tool), patch.object(driver.shutil, 'which', return_value='/tool'):
            driver.build(str(candidate), str(candidate.parent), False, staging=True)
        artifacts = candidate.parent / 'artifacts'
        self.assertEqual((artifacts / driver.PDF_NAME).read_bytes(), b'validated-pdf')
        self.assertTrue((artifacts / 'candidate.png').is_file())
        self.assertTrue((artifacts / 'visible.txt').is_file())
        self.assertEqual(self.pdf.read_bytes(), b'previous-valid-output')
        with self.assertRaises(ValueError):
            driver.build(str(candidate), str(self.root / 'elsewhere'), False, staging=True)
        with self.assertRaises(ValueError):
            driver.build(str(self.tex), '', False, staging=True)

    def test_publication_failure_restores_matched_output_set(self):
        png = self.root / 'ui/.cache/png/tailored-acme.png'
        png.parent.mkdir(parents=True)
        png.write_bytes(b'previous-render')
        replace = driver.os.replace
        def fail_png(source, destination):
            if Path(destination) == png: raise OSError('render publication failure')
            return replace(source, destination)
        with patch.object(driver, 'checked', side_effect=self.tool), patch.object(driver.shutil, 'which', return_value='/tool'), patch.object(driver.os, 'replace', side_effect=fail_png):
            with self.assertRaises(OSError): driver.build(str(self.tex), str(png.parent), False)
        self.assertEqual(self.pdf.read_bytes(), b'previous-valid-output')
        self.assertEqual(png.read_bytes(), b'previous-render')
        self.assertFalse(list(png.parent.glob('.resume-*')))

    def test_nonzero_wrapper_never_claims_success(self):
        scripts = self.root / 'scripts'; scripts.mkdir()
        for name in ('build.sh', 'resume_build.py'): shutil.copyfile(Path(__file__).parent / name, scripts / name)
        self.tex.write_text(r'\input{/etc/passwd}')
        result = subprocess.run(['bash', str(scripts / 'build.sh'), str(self.tex), '--no-text'], capture_output=True, text=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('✓ wrote', result.stdout)

    def test_cover_letter_publishes_beside_resume_without_replacing_it(self):
        self.tex = self.root / 'source/tech/cover-letter.tex'
        self.tex.parent.mkdir(parents=True)
        self.tex.write_text(r'\input{glyphtounicode}\begin{document}Letter\end{document}')
        resume = self.root / 'resumes/tech/Resume.pdf'
        resume.parent.mkdir(parents=True)
        resume.write_bytes(b'master-resume')
        tool = self.tool
        self.tool = lambda argv, **opts: 'Example Person contact info you@example.com\n' if argv[0] == 'pdftotext' else tool(argv, **opts)
        self.run_build()
        self.assertEqual((self.root / 'resumes/tech/Cover_Letter.pdf').read_bytes(), b'validated-pdf')
        self.assertEqual(resume.read_bytes(), b'master-resume')
        self.assertTrue((self.root / 'ui/.cache/png/tech-cover-letter.png').is_file())
        self.assertFalse(any('ats_check.py' in ' '.join(argv) for argv, _ in self.calls))
        self.tex = self.root / 'source/new-tech/cover-letter.tex'
        self.tex.parent.mkdir(parents=True)
        self.tex.write_text(r'\input{glyphtounicode}\begin{document}Letter\end{document}')
        self.run_build()
        self.assertEqual((self.root / 'resumes/new-tech/Cover_Letter.pdf').read_bytes(), b'validated-pdf')
        for bad in ('source/tailored/acme/cover-letter.tex', 'source/datacenter/cover-letter.tex', 'source/tech/notes.tex'):
            path = self.root / bad
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(r'\begin{document}x\end{document}')
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                driver.build(str(path), '', False)

    def test_tex_and_canonical_boundaries(self):
        driver.preflight(r'\input{glyphtounicode}')
        for code in (r'\input{/etc/passwd}', r'\write18{evil}', r'\openin1=secret', r'\csname input\endcsname', r'^^5cinput{secret}', r'\usepackage{../../secret}', r'\includegraphics{secret}', r'\@@input secret'):
            with self.subTest(code=code), self.assertRaises(ValueError): driver.preflight(code)
        link = self.tex.parent / 'alias.tex'; link.symlink_to(self.root / 'source/tech/resume.tex')
        with self.assertRaises(ValueError): driver.safe_path(link, 'source')
        png = self.root / 'png'; png.symlink_to(self.pdf.parent, target_is_directory=True)
        with self.assertRaises(ValueError): driver.safe_path(png)


if __name__ == '__main__': unittest.main()
