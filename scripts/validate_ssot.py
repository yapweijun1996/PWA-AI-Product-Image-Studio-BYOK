#!/usr/bin/env python3
"""Validate SSOT docs only; never claim app/provider/security runtime verification.

Dependencies: stdlib mandatory; optional PyYAML/jsonschema enable extra checks.
Run from any working directory: python3 scripts/validate_ssot.py
"""
from pathlib import Path
import hashlib, json, re, sys, datetime

ROOT = Path(__file__).resolve().parents[1]
errors=[]; warnings=[]; checks=[]

def ck(name, fn):
    try:
        fn(); checks.append({'check':name,'result':'PASS'})
    except Exception as exc:
        errors.append(f'{name}: {exc}'); checks.append({'check':name,'result':'FAIL','error':str(exc)})

def require(cond,msg):
    if not cond: raise ValueError(msg)

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()

def required_files():
    required=[
      'README.md','START_HERE_中文.md','AGENTS.md','SPEC.md','DESIGN.md','EPIC.md','ROADMAP.md','TASK.md',
      'docs/INDEX.md','docs/00-governance/SSOT_POLICY.md','docs/00-governance/DECISION_REGISTER.md',
      'docs/00-governance/REQUIREMENTS_TRACEABILITY.md','docs/01-product/PRD.md',
      'docs/02-architecture/SYSTEM_ARCHITECTURE.md','docs/03-security/BYOK_SECURITY.md',
      'docs/04-data/DATA_MODEL.md','docs/05-api/OPENAI_ADAPTER.md',
      'docs/06-ai/SEVEN_STYLE_ENGINE.md','docs/06-ai/BRAND_LOCK_ENGINE.md','docs/06-ai/VISUAL_QA.md',
      'docs/07-quality/E2E_ACCEPTANCE.md','docs/07-quality/RELEASE_GATES.md',
      'docs/08-delivery/TASK.md','docs/08-delivery/AI_AGENT_HANDOFF.md',
      'docs/09-research/SOURCES.md','contracts/openapi.yaml','contracts/style-presets.json',
      'contracts/schemas/product.schema.json','contracts/schemas/generation-job.schema.json',
      'contracts/schemas/qa-report.schema.json','contracts/schemas/export-manifest.schema.json',
      'fixtures/sample-product.json','fixtures/sample-generation-job.json','fixtures/sample-qa-report.json',
      'fixtures/sample-export-manifest.json','package-manifest.json','SHA256SUMS.txt']
    for name in required: require((ROOT/name).is_file(),f'missing {name}')

def md_links():
    # Intentionally excludes remote URLs, fragment-only anchors, images/data links and code-fenced content.
    linkre=re.compile(r'(?<!!)\[[^\]\n]+\]\(([^)]+)\)')
    problems=[]
    for fp in ROOT.rglob('*.md'):
        txt=fp.read_text(encoding='utf-8')
        require(txt.strip(),f'empty markdown {fp.relative_to(ROOT)}')
        require(len(re.findall(r'^\s*```',txt,flags=re.MULTILINE))%2==0,
                f'unbalanced code fences in {fp.relative_to(ROOT)}')
        without_code=re.sub(r'(?ms)^\s*```.*?^\s*```\s*$', '', txt)
        for m in linkre.finditer(without_code):
            raw=m.group(1).strip().split()[0].strip('<>')
            if raw.startswith(('https://','http://','mailto:','data:','#','/')): continue
            dest=(fp.parent / raw.split('#')[0]).resolve()
            if not dest.is_relative_to(ROOT.resolve()) or not dest.exists():
                problems.append(f'{fp.relative_to(ROOT)} -> {raw}')
    require(not problems, 'broken relative links: '+ '; '.join(problems[:30]))

def manifests():
    man=json.loads((ROOT/'package-manifest.json').read_text('utf-8'))
    require(man.get('status')=='DOCUMENTATION_ONLY_NOT_IMPLEMENTED','manifest status mismatch')
    listed={x['path']:x for x in man['files']}
    exclude={'package-manifest.json','SHA256SUMS.txt','validation-report.json'}
    actual={str(p.relative_to(ROOT)).replace('\\','/') for p in ROOT.rglob('*') if p.is_file() and str(p.relative_to(ROOT)).replace('\\','/') not in exclude}
    require(set(listed)==actual, f'manifest set mismatch missing={sorted(actual-set(listed))} extra={sorted(set(listed)-actual)}')
    for name, row in listed.items():
        fp=ROOT/name
        require(row['sha256']==digest(fp),f'hash mismatch: {name}')
        require(row['bytes']==fp.stat().st_size,f'size mismatch: {name}')
    sums=(ROOT/'SHA256SUMS.txt').read_text('utf-8').strip().splitlines()
    expected=[f"{listed[name]['sha256']}  {name}" for name in sorted(listed)]
    require(sums==expected,'SHA256SUMS mismatch')

def json_and_style():
    for fp in ROOT.rglob('*.json'): json.loads(fp.read_text('utf-8'))
    p=json.loads((ROOT/'contracts/style-presets.json').read_text('utf-8'))
    ids=[x['id'] for x in p['styles']]
    require(ids==['studio','hero','lifestyle','flat_lay','macro','ugc','billboard'],f'styles not canonical: {ids}')
    require(len(set(ids))==7 and all(x.get('promptAddon') and x.get('singleIndependentJob') for x in p['styles']), 'style definitions invalid')
    require(p['sourceSkillVersion']=='1.0.1','skill version changed without review')

def schemas_and_fixtures():
    try:
        from jsonschema import Draft202012Validator, FormatChecker
    except ImportError:
        warnings.append('OPTIONAL jsonschema not installed; full JSON Schema validation unavailable')
        return
    pairs=[('product','sample-product'),('generation-job','sample-generation-job'),('qa-report','sample-qa-report'),('export-manifest','sample-export-manifest')]
    for sc, ex in pairs:
        s=json.loads((ROOT/f'contracts/schemas/{sc}.schema.json').read_text('utf-8'))
        obj=json.loads((ROOT/f'fixtures/{ex}.json').read_text('utf-8'))
        Draft202012Validator.check_schema(s)
        errors_found=list(Draft202012Validator(s,format_checker=FormatChecker()).iter_errors(obj))
        require(not errors_found, f'{sc}: '+ '; '.join(str(e.message) for e in errors_found[:5]))
    q=json.loads((ROOT/'fixtures/sample-qa-report.json').read_text('utf-8'))
    v=q['scores']; score=(v['design']*35+v['typography']*25+v['geometry']*15+v['realism']*15+v['style']*10)/5
    require(abs(score-q['weightedScore'])<1e-8,'weighted QA fixture formula incorrect')
    require(q['humanDecision']=='PENDING','fixture cannot represent real approval')

def yaml_contract():
    try: import yaml
    except ImportError:
        warnings.append('OPTIONAL PyYAML not installed; full OpenAPI YAML parse unavailable')
        return
    spec=yaml.safe_load((ROOT/'contracts/openapi.yaml').read_text('utf-8'))
    require(spec['openapi'].startswith('3.1.'),'must be OpenAPI 3.1')
    paths=spec['paths']; expected=['/session/connect','/session/status','/session','/images/approvals','/images/generate','/health']
    require(set(paths)==set(expected),'gateway endpoint list differs from reference design')
    require(spec['x-release-status']=='PROPOSED_NOT_IMPLEMENTED','contract incorrectly claims implementation')
    # Verify all local $ref component pointers resolve; external refs are not used by this contract.
    def recur(node):
        if isinstance(node,dict):
            if '$ref' in node:
                ref=node['$ref']; require(ref.startswith('#/'),f'external OpenAPI ref unsupported: {ref}')
                target=spec
                for part in ref[2:].split('/'):
                    part=part.replace('~1','/').replace('~0','~')
                    require(isinstance(target,dict) and part in target,f'broken openapi $ref: {ref}')
                    target=target[part]
            for child in node.values(): recur(child)
        if isinstance(node,list):
            for child in node: recur(child)
    recur(spec)
    image=paths['/images/generate']['post']
    require({'AppSession','ProviderSession'}==set(image['security'][0]),'generation requires app and provider authorization sessions')
    connect=paths['/session/connect']['post']
    schema=connect['requestBody']['content']['application/json']['schema']
    require(schema.get('additionalProperties') is False and set(schema.get('properties',{}))=={'provider'},'connect must not accept a provider key')
    require('configured' in spec['components']['schemas']['SessionStatus']['required'],'provider configuration status missing')
    approval=paths['/images/approvals']['post']
    require({'AppSession','ProviderSession'}==set(approval['security'][0]),'approval requires both authorization sessions')
    require(any(p.get('$ref')=='#/components/parameters/AttemptApprovalId' for p in image['parameters']),'generation requires an attempt approval')

def cost_math():
    cost=json.loads((ROOT/'fixtures/cost-scenario.json').read_text('utf-8'))
    r=cost['ratesPerMillion']; t=cost['assumedTokensPerAttempt']
    one=(r['textInput']*t['textInput']+r['imageInput']*t['imageInput']+r['imageOutput']*t['imageOutput'])/1e6
    require(abs(one-float(cost['computedEstimatePerAttemptUSD']))<1e-9,'cost math wrong')
    require(abs(one*7-float(cost['sevenAttemptsUSD']))<1e-9,'7-style cost math wrong')

def no_secrets():
    bad=[]
    for fp in ROOT.rglob('*'):
        if not fp.is_file() or fp.suffix not in ('.md','.json','.yaml','.py','.txt'): continue
        txt=fp.read_text('utf-8')
        if re.search(r'(?<!\w)sk-(?:proj-)?[A-Za-z0-9_-]{30,}',txt): bad.append(str(fp.relative_to(ROOT)))
        if re.search(r'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----',txt): bad.append(str(fp.relative_to(ROOT)))
    require(not bad,'potential real secrets in '+', '.join(sorted(set(bad))))

for name,func in [
 ('required_files',required_files),('markdown_links_and_fences',md_links),('checksum_manifest',manifests),
 ('json_and_seven_styles',json_and_style),('json_schemas_and_fixtures',schemas_and_fixtures),
 ('openapi_yaml_and_refs',yaml_contract),('cost_formula',cost_math),('no_obvious_secrets',no_secrets)
]: ck(name,func)

result={'project':'PWA-AI-Product-Image-Studio-BYOK','bundleVersion':json.loads((ROOT/'package-manifest.json').read_text('utf-8'))['version'],
 'purpose':'DOCUMENTATION VALIDATION ONLY - not app/API/visual E2E',
 'status':'FAIL' if errors else ('WARN' if warnings else 'PASS'),
 'checks':checks, 'errors':errors, 'warnings':warnings,
 'markdownDocuments':len(list(ROOT.rglob('*.md'))),
 'fileCount':len([p for p in ROOT.rglob('*') if p.is_file()]),
 'testScope':'static doc syntax, links, checksums, JSON schemas, YAML refs, style integrity, cost scenario, obvious secret patterns'}
(ROOT/'validation-report.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result,ensure_ascii=False,indent=2))
sys.exit(1 if errors else 0)
