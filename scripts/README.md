# SSOT Documentation Validation

The validator works in both the Git checkout and an unpacked documentation package:

```bash
python3 scripts/validate_ssot.py
python3 scripts/test_validate_ssot.py -v
```

It prints JSON to standard output and does not overwrite the checkout's existing `validation-report.json`. To explicitly write a report, pass `--report /path/to/report.json`; a report inside the package must use the excluded root `validation-report.json` name or it will be treated as an unexpected payload on the next run.

Inventory and content scans exclude Git metadata, `.DS_Store`, root `.gitattributes`, root `validation-report.json` and local `.env` / `.env.*` files except the manifest-listed `.env.example`. They do not read local environment secrets. Other unlisted files, missing or modified listed files and payload symlinks fail validation; symlinks are rejected before content checks. The manifest and SHA list exclude self-referential metadata.

For **full** JSON Schema and OpenAPI YAML validation, install optional dependencies using `python3 -m pip install -r scripts/requirements-doc-validation.txt`. If they are unavailable, the validator reports `WARN`, not `PASS`. The regression tests use temporary copies and synthetic secrets; no provider call occurs.

These checks verify documentation syntax, links, checksums, schemas, style definitions, cost calculations and obvious secret patterns. They do not prove PWA execution, provider availability, runtime security or image fidelity.
