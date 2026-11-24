"""Import supplied ZIP/Unity archives without executing any included content."""
import argparse
import concurrent.futures
import hashlib
import json
import pathlib
import re
import shutil
import tarfile
import time
import zipfile

import numpy as np
import soundfile as sf

ROOT = pathlib.Path(__file__).resolve().parents[1]
PACKS = 'noise_tones_dtmf_tests technology multimedia human_elements emergency_effects foley_footsteps sports impacts foley science_fiction horror weapons animals crashes transportation drones underwater production_elements imaging_elements industry weather fire_explosions ambience_1 ambience_2 liquid_water'.split()
CATEGORIES = {
 'interface': ('Интерфейс', 'Кнопки, сигналы и уведомления', 'mouse', '#7561e8'),
 'retro': ('Ретро и аркады', 'Пиксельные миры и 8-битные эффекты', 'gamepad', '#e7904f'),
 'success': ('Награды и победы', 'Подбор предметов и достижения', 'sparkles', '#d5aa43'),
 'negative': ('Ошибки и поражения', 'Отказы, проигрыш и напряжение', 'circle-x', '#d2677b'),
 'weapons': ('Оружие', 'Выстрелы, перезарядка и сражения', 'crosshair', '#c87961'),
 'impacts': ('Удары', 'Попадания, столкновения и падения', 'zap', '#d39a4b'),
 'explosions': ('Огонь и взрывы', 'Взрывы, пламя и потрескивание', 'flame', '#dc7556'),
 'footsteps': ('Шаги', 'Ходьба, бег и разные поверхности', 'footprints', '#66a491'),
 'foley': ('Предметы и фоли', 'Повседневные действия и материалы', 'box', '#ae866c'),
 'scifi': ('Фантастика', 'Лазеры, пришельцы и энергия', 'orbit', '#8976d3'),
 'horror': ('Хоррор', 'Монстры и тревожные звуки', 'ghost', '#986da1'),
 'voices': ('Голоса и персонажи', 'Реплики, реакции и дыхание', 'mic', '#c580a8'),
 'animals': ('Животные', 'Птицы, звери и насекомые', 'paw', '#8aa85d'),
 'ambience': ('Атмосферы', 'Пространства, города и окружение', 'wind', '#65a198'),
 'weather': ('Погода', 'Дождь, ветер и гром', 'cloud', '#679bc0'),
 'water': ('Вода', 'Всплески, капли и потоки', 'droplet', '#649ec9'),
 'underwater': ('Под водой', 'Глубина, пузыри и подводные миры', 'waves', '#5c9baf'),
 'transport': ('Транспорт', 'Моторы, машины и самолёты', 'car', '#828bc4'),
 'machines': ('Механизмы', 'Машины, сервоприводы и роботы', 'settings', '#8a96a9'),
 'technology': ('Техника', 'Устройства и электроника', 'cpu', '#6fa3ae'),
 'emergency': ('Сирены и тревоги', 'Сигнализация и экстренные службы', 'siren', '#cb7b7d'),
 'sports': ('Спорт', 'Движение, инвентарь и игры', 'ball', '#89a06d'),
 'crashes': ('Разрушения', 'Треск, обломки и разбитое стекло', 'layers', '#bb8c74'),
 'production': ('Переходы и акценты', 'Свуши, титры и звуковые акценты', 'audio-lines', '#9b7cc4'),
 'drones': ('Дроны и гул', 'Звуковые подложки и низкие тона', 'radio', '#8c83bd'),
 'bells': ('Колокола и таймеры', 'Звон, отсчёты и резонанс', 'bell', '#bd9c5e'),
 'tests': ('Тестовые сигналы', 'Шум, частоты, DTMF и измерения', 'activity', '#8a919d'),
}
PACK_CATEGORY = dict(zip(PACKS, 'tests technology interface voices emergency footsteps sports impacts foley scifi horror weapons animals crashes transport drones underwater production production machines weather explosions ambience ambience water'.split()))

def category_unity(name):
 n = name.upper()
 for prefix, cat in [('RETRO','retro'),('SUCCESS','success'),('NEGATIVE','negative'),('WEAPON','weapons'),('IMPACT','impacts'),('FOOTSTEP','footsteps'),('VOCAL','voices'),('MECH','machines'),('ALARM','emergency'),('BONG','bells'),('TECH CHARGER','scifi'),('TECH INTERFACE','interface'),('EXPLOS','explosions'),('MAGIC','scifi'),('SWOOSH','production'),('WHOOSH','production'),('CARTOON','retro')]:
  if prefix in n: return cat
 return 'production'

def safe_path(base, relative):
 target = (base / relative).resolve()
 if not target.is_relative_to(base.resolve()): raise ValueError('Unsafe archive path: '+relative)
 return target

def describe(path, source, category, source_path):
 info = sf.info(str(path))
 if not info.frames: raise ValueError('Empty audio: '+str(path))
 peaks = []
 with sf.SoundFile(str(path)) as audio:
  for start in np.linspace(0, max(0, info.frames-512), 64, dtype=np.int64):
   audio.seek(int(start))
   samples = audio.read(min(1024, info.frames-int(start)), dtype='float32', always_2d=True)
   peaks.append(float(np.max(np.abs(samples))) if samples.size else 0.)
 maxpeak = max(peaks) or 1
 peaks = [round(min(1, p/maxpeak)**0.65*100) for p in peaks]
 name = path.stem
 # Keep the real original filename separately for search and download.
 title = re.sub(r'^(?:Module )?(?:Production Element Title |Science Fiction Sci-Fi |Transportation |Technology |Multimedia |Human |Emergency |Foley Footstep |Foley |Sports |Impact |Horror |Weapon |Animal |Crash |Drone Production Element Imaging |Underwater |Industry |Weather |Ambience |Liquid )', '', name, flags=re.I)
 relative = path.relative_to(ROOT).as_posix()
 return {'id': hashlib.sha1(relative.encode()).hexdigest()[:14], 'name':title, 'originalName':path.name, 'path':relative, 'sourcePath':source_path, 'category':category, 'source':source, 'duration':round(info.duration,3), 'bytes':path.stat().st_size, 'sampleRate':info.samplerate, 'channels':info.channels, 'subtype':info.subtype, 'peaks':peaks}

def import_zip(downloads, pack):
 tracks, errors = [], []
 with zipfile.ZipFile(downloads / (pack+'.zip')) as archive:
  for item in archive.infolist():
   if item.is_dir(): continue
   suffix = pathlib.Path(item.filename).suffix.lower()
   if suffix == '.wav':
    path = safe_path(ROOT/'audio'/'adobe'/pack, item.filename)
    path.parent.mkdir(parents=True,exist_ok=True)
    if not path.exists() or path.stat().st_size != item.file_size:
     with archive.open(item) as src, path.open('wb') as dst: shutil.copyfileobj(src,dst)
    try: tracks.append(describe(path,'adobe',PACK_CATEGORY[pack],item.filename))
    except Exception as ex: errors.append({'file':item.filename,'error':str(ex)})
 print(f'{pack}: {len(tracks)} sounds, {len(errors)} errors',flush=True)
 return tracks, errors

def import_unity(path):
 tracks, errors = [], []
 with tarfile.open(path) as archive:
  members = archive.getmembers()
  paths = {}
  for m in members:
   if m.name.endswith('/pathname'):
    raw = archive.extractfile(m).read().decode('utf-8-sig',errors='replace')
    paths[m.name.rsplit('/',1)[0]] = raw.split('\n')[0].strip('\x00\r ')
  for m in members:
   if not m.isfile() or not m.name.endswith('/asset'): continue
   original = paths.get(m.name.rsplit('/',1)[0],'')
   if not original.lower().endswith('.wav'): continue
   relative = original.removeprefix('Assets/2000 Game Sound FX/')
   target = safe_path(ROOT/'audio'/'game-sound-fx',relative)
   target.parent.mkdir(parents=True,exist_ok=True)
   if not target.exists() or target.stat().st_size != m.size:
    with archive.extractfile(m) as src, target.open('wb') as dst: shutil.copyfileobj(src,dst)
   try: tracks.append(describe(target,'game-sound-fx',category_unity(relative),original))
   except Exception as ex: errors.append({'file':original,'error':str(ex)})
 print(f'2000 Game Sound FX: {len(tracks)} sounds, {len(errors)} errors',flush=True)
 return tracks, errors

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--downloads',type=pathlib.Path,default=pathlib.Path.home()/'Downloads')
 args=parser.parse_args()
 tracks, errors = [], []
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
  jobs=[pool.submit(import_zip,args.downloads,p) for p in PACKS]
  jobs.append(pool.submit(import_unity,args.downloads/'Telegram Desktop'/'2000 Game Sound FX.unitypackage'))
  for job in concurrent.futures.as_completed(jobs):
   ts, es = job.result(); tracks.extend(ts); errors.extend(es)
 tracks.sort(key=lambda x:(x['source']!='game-sound-fx',x['category']!='retro',x['category'],x['name'].lower()))
 categories=[{'id':k,'name':v[0],'description':v[1],'icon':v[2],'color':v[3],'count':sum(t['category']==k for t in tracks)} for k,v in CATEGORIES.items()]
 data={'version':1,'generatedAt':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'categories':categories,'sources':[{'id':'adobe','name':'Adobe Audition','description':'25 тематических архивов'},{'id':'game-sound-fx','name':'2000 Game Sound FX','description':'Unity sound pack'}],'stats':{'count':len(tracks),'bytes':sum(t['bytes'] for t in tracks),'duration':round(sum(t['duration'] for t in tracks),2)},'tracks':tracks}
 (ROOT/'data').mkdir(exist_ok=True)
 (ROOT/'.local').mkdir(exist_ok=True)
 (ROOT/'data'/'catalog.json').write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 (ROOT/'.local'/'import-report.json').write_text(json.dumps({'stats':data['stats'],'errors':errors,'excluded':[{'file':'EmbeddedAssetsTextures.zip','reason':'PNG texture, no audio'},{'file':'EmbeddedAssetsTextures (1).zip','reason':'PNG texture, no audio'}]},ensure_ascii=False,indent=2),encoding='utf-8')
 print(json.dumps(data['stats']),flush=True)
 if errors: raise SystemExit(f'{len(errors)} files need attention; see .local/import-report.json')

if __name__=='__main__': main()
