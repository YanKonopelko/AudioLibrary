"""Build the small GitHub Pages catalog; original audio stays local."""
import json
import argparse
import pathlib
import shutil
import zipfile

ROOT=pathlib.Path(__file__).resolve().parents[1]
FILES=['index.html','styles.css','app.js','config.json','assets','data']

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--audio-parts',type=pathlib.Path);args=parser.parse_args()
 output=ROOT/'dist'
 output.mkdir(exist_ok=True)
 for name in FILES:
  source=ROOT/name
  if not source.exists():raise SystemExit(f'Missing {name}. Run scripts/import_audio.py first.')
  target=output/name
  if source.is_dir():shutil.copytree(source,target,dirs_exist_ok=True)
  else:shutil.copy2(source,target)
 (output/'.nojekyll').touch()
 catalog=json.loads((ROOT/'data/catalog.json').read_text(encoding='utf-8'))
 if any(t.get('preview') for t in catalog['tracks']):
  parts=args.audio_parts or ROOT/'.local'/'release'
  archives=sorted(parts.glob('wavebox-audio-*.zip'))
  if not archives:raise SystemExit('Missing encoded audio release parts. Run scripts/encode_audio.py first or download the audio-v1 release.')
  for archive in archives:
   with zipfile.ZipFile(archive) as z:
    for item in z.infolist():
     target=(output/item.filename).resolve()
     if not target.is_relative_to(output.resolve()) or not item.filename.startswith('media/'):raise ValueError('Unsafe audio archive path')
    z.extractall(output)
  for track in catalog['tracks']:
   path=output/track['preview']['path']
   if not path.is_file() or path.stat().st_size!=track['preview']['bytes']:raise SystemExit(f'Missing encoded audio: {path}')
 size=sum(p.stat().st_size for p in output.rglob('*') if p.is_file())
 if size>=1000*1024*1024:raise SystemExit('Export exceeds the GitHub Pages size budget.')
 print(f'GitHub Pages build: {output} ({size/1048576:.1f} MiB)')

if __name__=='__main__':main()
