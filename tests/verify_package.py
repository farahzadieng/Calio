"""Validates handoff only, not a running application. Requires jsonschema and Pillow."""
from pathlib import Path
import json,csv,re,math
from jsonschema import Draft202012Validator, FormatChecker
from PIL import Image
p=Path(__file__).resolve().parents[1]
def load(n):return json.loads((p/n).read_text(encoding='utf-8'))
for f in (p/'schemas').glob('*.json'): Draft202012Validator.check_schema(json.loads(f.read_text()))
for name in ('extract','portion','research','weekly'):
 Draft202012Validator(load(f'schemas/{name}.schema.json'),format_checker=FormatChecker()).validate(load(f'fixtures/{name}-output.json'))
keys=[n['key'] for n in load('data/nutrients.json')]; assert len(keys)==len(set(keys))==39
assert set(load('schemas/nutrients.schema.json')['required'])==set(keys)
with (p/'data/foods.csv').open(encoding='utf-8-sig',newline='') as f: rows=list(csv.reader(f)); assert len(rows)==1 and set(keys)<=set(rows[0])
assert all(not load('data/foods.json')[k] for k in ['foods','aliases','portions'])
def arrays(s):
 a=dict((k,v.strip().splitlines()) for k,v in re.findall(r'(\w+):\s*\{([^}]*)\}',s)); assert set(a)=={'Dates','Resting_Energy','Active_Energy','Steps','Distance'}; assert len({len(x) for x in a.values()})==1; return a
valid=arrays((p/'fixtures/health-valid.txt').read_text()); assert len(valid['Dates'])==3
try: arrays((p/'fixtures/health-invalid.txt').read_text())
except AssertionError: pass
else: raise AssertionError('Invalid fixture accepted')
assert sum(float(valid[k][0]) for k in ['Resting_Energy','Active_Energy'])==1800
m=load('fixtures/monthly-input.json'); assert math.isclose((m['intake_kcal']-m['expenditure_kcal'])/m['coefficient'],m['expected_delta_kg'])
for theme in ('light','dark'):
 for size in (192,512):
  with Image.open(p/f'assets/brand/icon-{theme}-{size}.png') as im: assert im.size==(size,size); im.verify()
for f in (p/'assets').rglob('*'):
 if f.suffix in ('.png','.webp','.jpg'):
  with Image.open(f) as im: im.verify()
for required in ['AGENT.md','README.md','docs/ARCHITECTURE.md','docs/TESTING.md','prompts/05-monthly-consultation-template.md']: assert (p/required).is_file()
font = p / 'Webfonts/Webfonts/woff2/BonyadeKoodak-VF.woff2'
assert font.is_file() and font.read_bytes()[:4] == b'wOF2'
print('PASS: schemas, 4 structured fixtures, 39 nutrients, empty library, Health fixture shapes, monthly arithmetic, image integrity and owner-supplied font package. No app workflows tested.')
