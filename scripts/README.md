# SSOT Documentation Validation

The validator was designed for the unpacked documentation payload. It recursively counts every file under its root, including Git metadata, operating-system artifacts and `.gitattributes` if present; it also rewrites `validation-report.json`. Running it directly in the current checkout therefore reports a manifest-set mismatch. The checkout-scope repair is tracked as `T-002` in [the task ledger](../docs/08-delivery/TASK.md).

To validate only the existing manifest-listed payload without modifying this checkout, run from the project root:

```bash
python3 - <<'PY'
from pathlib import Path
from tempfile import TemporaryDirectory
import json, shutil, subprocess, sys

root = Path.cwd()
manifest = json.loads((root / 'package-manifest.json').read_text())
names = [entry['path'] for entry in manifest['files']]
names += ['package-manifest.json', 'SHA256SUMS.txt', 'validation-report.json']
with TemporaryDirectory(prefix='byok-doc-validation-') as temporary:
    target = Path(temporary)
    for name in names:
        source = root / name
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
    result = subprocess.run([sys.executable, 'scripts/validate_ssot.py'], cwd=target)
    sys.exit(result.returncode)
PY
```

For **full** JSON Schema and OpenAPI YAML validation, install optional dependencies using `python3 -m pip install -r scripts/requirements-doc-validation.txt`. The validator uses standard-library file/hash/link/secret/fixture checks even when optional packages are absent, but reports the reduced scope as WARN — not PASS.

This isolated check verifies the manifest-listed payload and its references; it deliberately does **not** detect extra files in the checkout or prove that the manifest includes every intended source file. Review unexpected files separately. `package-manifest.json` and `SHA256SUMS.txt` checksum the payload, excluding the self-referential metadata and `validation-report.json`. The validator writes a report inside the temporary copy; it does not refresh the checkout's existing report. A missing optional dependency produces `WARN` even if individual checks display `PASS`. None of these checks verify PWA execution, provider API availability or actual image fidelity.
