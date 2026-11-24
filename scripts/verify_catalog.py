"""Check every imported original and the static-site contract."""
import collections
import json
import pathlib
import urllib.parse
import urllib.request

ROOT=pathlib.Path(__file__).resolve().parents[1]

def main():
 data=json.loads((ROOT/'data/catalog.json').read_text(encoding='utf-8'))
 tracks=data['tracks'];ids=set();paths=set();counts=collections.Counter();total=0;duration=0
 for t in tracks:
  assert t['id'] not in ids, f'Duplicate ID: {t["id"]}'
  assert t['path'] not in paths, f'Duplicate path: {t["path"]}'
  ids.add(t['id']);paths.add(t['path'])
  p=(ROOT/t['path']).resolve()
  assert p.is_relative_to((ROOT/'audio').resolve()),t['path']
  assert p.is_file() and p.stat().st_size==t['bytes'],f'Missing or changed original: {p}'
  assert t['duration']>0 and t['sampleRate']>0 and t['channels']>0,t['id']
  assert len(t['peaks'])==64 and all(0<=v<=100 for v in t['peaks']),t['id']
  counts[t['category']]+=1;total+=t['bytes'];duration+=t['duration']
 assert total==data['stats']['bytes']
 assert len(tracks)==data['stats']['count']
 assert abs(duration-data['stats']['duration'])<.02
 for c in data['categories']:assert counts[c['id']]==c['count'],c['id']
 assert set(counts)=={c['id'] for c in data['categories']}
 for base in [ROOT/'audio',ROOT/'.local'/'licenses']:
  assert not any(p.is_file() and 'license' in p.name.lower() for p in base.rglob('*')),f'License files remain in {base}'
 print(f'PASS: {len(tracks):,} originals, {len(counts)} categories, sizes, IDs, waveforms, totals, no imported license documents.')
 print('Sources:',dict(collections.Counter(t['source'] for t in tracks)))

if __name__=='__main__':main()
