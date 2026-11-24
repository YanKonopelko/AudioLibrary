"""Make browser-ready Opus copies and small GitHub Release archive parts."""
import argparse
import concurrent.futures
import json
import os
import pathlib
import subprocess
import time
import zipfile

import imageio_ffmpeg

ROOT=pathlib.Path(__file__).resolve().parents[1]

def main():
 parser=argparse.ArgumentParser();parser.add_argument('--workers',type=int,default=8);args=parser.parse_args()
 catalog_path=ROOT/'data/catalog.json';catalog=json.loads(catalog_path.read_text(encoding='utf-8'))
 output=ROOT/'.local'/'encoded';output.mkdir(parents=True,exist_ok=True)
 ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
 def encode(t):
  target=output/(t['id']+'.ogg')
  if not target.exists() or target.stat().st_size==0:
   temp=output/(t['id']+'.tmp.ogg')
   proc=subprocess.run([ffmpeg,'-nostdin','-hide_banner','-loglevel','error','-y','-i',str(ROOT/t['path']),'-vn','-map_metadata','-1','-ac',str(min(2,t['channels'])),'-c:a','libopus','-b:a','80k','-vbr','constrained','-compression_level','6',str(temp)],capture_output=True,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)
   if proc.returncode:raise RuntimeError(t['path']+': '+proc.stderr.decode(errors='replace'))
   temp.replace(target)
  return t['id'],target.stat().st_size
 encoded={};start=time.time()
 with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
  futures=[pool.submit(encode,t) for t in catalog['tracks']]
  for job in concurrent.futures.as_completed(futures):
   key,size=job.result();encoded[key]=size
   if len(encoded)%500==0:print(f'Encoded {len(encoded)}/{len(futures)} ({time.time()-start:.0f}s)',flush=True)
 total=sum(encoded.values())
 if total>950_000_000:raise SystemExit(f'Audio exceeds deployment budget: {total}')
 for t in catalog['tracks']:t['preview']={'path':'media/'+t['id']+'.ogg','bytes':encoded[t['id']]}
 catalog['stats']['previewBytes']=total
 catalog_path.write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 release=ROOT/'.local'/'release';release.mkdir(exist_ok=True)
 parts=[];part=None;part_size=0
 try:
  for t in catalog['tracks']:
   if part is None or part_size+encoded[t['id']]>90_000_000:
    if part:part.close()
    target=release/f'wavebox-audio-{len(parts)+1:02d}.zip';parts.append(target)
    part=zipfile.ZipFile(target,'w',compression=zipfile.ZIP_STORED,allowZip64=True);part_size=0
   part.write(output/(t['id']+'.ogg'),arcname=t['preview']['path']);part_size+=encoded[t['id']]
 finally:
  if part:part.close()
 report={'count':len(encoded),'bytes':total,'parts':[{'name':p.name,'bytes':p.stat().st_size} for p in parts]}
 (ROOT/'.local'/'encode-report.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
 print(json.dumps(report),flush=True)

if __name__=='__main__':main()
