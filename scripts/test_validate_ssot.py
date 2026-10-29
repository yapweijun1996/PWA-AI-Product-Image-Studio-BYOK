#!/usr/bin/env python3
"""Exercise checkout and package inventory behavior using synthetic files only."""
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ValidatorInventoryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='ssot-validator-test-')
        self.addCleanup(self.temporary.cleanup)
        self.package = Path(self.temporary.name)
        manifest = json.loads((ROOT / 'package-manifest.json').read_text(encoding='utf-8'))
        for name in [entry['path'] for entry in manifest['files']] + ['package-manifest.json', 'SHA256SUMS.txt']:
            target = self.package / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(ROOT / name, target)

    def validate(self, *arguments):
        result = subprocess.run(
            [sys.executable, str(self.package / 'scripts/validate_ssot.py'), *arguments],
            cwd=self.package, capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.stderr, '')
        return result, json.loads(result.stdout)

    def test_checkout_metadata_and_local_secrets_are_not_payload(self):
        (self.package / '.git').mkdir()
        (self.package / '.git/config.json').write_text('not JSON', encoding='utf-8')
        (self.package / '.gitattributes').write_text('* text=auto\n', encoding='utf-8')
        (self.package / '.DS_Store').write_text('metadata', encoding='utf-8')
        secret = 'sk-' + 'A' * 40
        (self.package / '.env').write_text(secret, encoding='utf-8')
        (self.package / 'app').mkdir()
        (self.package / 'app/application.json').write_text('not documentation JSON', encoding='utf-8')
        report = self.package / 'validation-report.json'
        report.write_text('owner report', encoding='utf-8')
        result, output = self.validate()
        self.assertEqual(result.returncode, 0, output)
        self.assertNotIn(secret, result.stdout)
        self.assertEqual(report.read_text(encoding='utf-8'), 'owner report')
        self.assertIn(output['status'], ('PASS', 'WARN'))

    def test_unexpected_and_changed_payload_are_rejected(self):
        unexpected = self.package / 'docs/unexpected.md'
        unexpected.write_text('# Unlisted\n', encoding='utf-8')
        result, output = self.validate()
        self.assertEqual(result.returncode, 1)
        self.assertTrue(any('docs/unexpected.md' in error for error in output['errors']))
        unexpected.unlink()
        with (self.package / 'README.md').open('a', encoding='utf-8') as stream:
            stream.write('\nChanged payload.\n')
        result, output = self.validate()
        self.assertEqual(result.returncode, 1)
        self.assertTrue(any('hash mismatch: README.md' in error for error in output['errors']))

    def test_missing_payload_is_rejected(self):
        (self.package / 'fixtures/sample-product.json').unlink()
        result, output = self.validate()
        self.assertEqual(result.returncode, 1)
        self.assertTrue(any('fixtures/sample-product.json' in error for error in output['errors']))

    def test_payload_symlink_is_rejected_before_reading_its_target(self):
        secret = 'sk-' + 'B' * 40
        (self.package / '.env').write_text(secret, encoding='utf-8')
        fixture = self.package / 'fixtures/sample-product.json'
        fixture.unlink()
        fixture.symlink_to(self.package / '.env')
        result, output = self.validate()
        self.assertEqual(result.returncode, 1)
        self.assertEqual(output['checks'][0]['check'], 'payload_symlinks')
        self.assertNotIn(secret, result.stdout)

    def test_explicit_report_is_written_only_when_requested(self):
        report = Path(self.temporary.name).parent / (self.package.name + '-report.json')
        self.addCleanup(report.unlink, missing_ok=True)
        result, output = self.validate('--report', str(report))
        self.assertEqual(result.returncode, 0, output)
        self.assertEqual(json.loads(report.read_text(encoding='utf-8')), output)


if __name__ == '__main__':
    unittest.main()
