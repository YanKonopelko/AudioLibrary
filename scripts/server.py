"""Serve the local library with byte ranges for instant WAV seeking."""
import argparse
import http.server
import json
import pathlib
import re
import shutil
import socketserver
import webbrowser

ROOT=pathlib.Path(__file__).resolve().parents[1]

class LibraryHandler(http.server.SimpleHTTPRequestHandler):
 extensions_map={**http.server.SimpleHTTPRequestHandler.extensions_map,'.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.wav':'audio/wav'}
 def __init__(self,*args,**kwargs):
  super().__init__(*args,directory=str(ROOT),**kwargs)

 def do_GET(self):
  if self.path.split('?',1)[0]=='/local-library.json':
   payload=json.dumps({'available':(ROOT/'audio').is_dir()}).encode()
   self.send_response(200)
   self.send_header('Content-Type','application/json')
   self.send_header('Content-Length',str(len(payload)))
   self.send_header('Cache-Control','no-store')
   self.end_headers();self.wfile.write(payload);return
  # Keep Git metadata and other checkout-local state outside the web surface.
  from urllib.parse import unquote, urlsplit
  parts=pathlib.PurePosixPath(unquote(urlsplit(self.path).path)).parts
  if any(part.startswith('.') for part in parts if part not in ('/','.')):
   self.send_error(404);return
  super().do_GET()

 def send_head(self):
  path=pathlib.Path(self.translate_path(self.path))
  range_header=self.headers.get('Range')
  if not range_header or not path.is_file():return super().send_head()
  match=re.fullmatch(r'bytes=(\d*)-(\d*)',range_header)
  total=path.stat().st_size
  if not match or not any(match.groups()):
   self.send_error(416,'Invalid byte range');return None
  first,last=match.groups()
  if first:
   start=int(first);end=min(int(last),total-1) if last else total-1
  else:
   start=max(0,total-int(last));end=total-1
  if start>=total or start>end:
   self.send_response(416);self.send_header('Content-Range',f'bytes */{total}');self.end_headers();return None
  stream=path.open('rb');stream.seek(start)
  self.send_response(206)
  self.send_header('Content-Type',self.guess_type(str(path)))
  self.send_header('Accept-Ranges','bytes')
  self.send_header('Content-Range',f'bytes {start}-{end}/{total}')
  self.send_header('Content-Length',str(end-start+1))
  self.end_headers();self._range_remaining=end-start+1
  return stream

 def copyfile(self,source,outputfile):
  remaining=getattr(self,'_range_remaining',None)
  try:
   if remaining is None:shutil.copyfileobj(source,outputfile);return
   while remaining>0:
    data=source.read(min(262144,remaining))
    if not data:break
    outputfile.write(data);remaining-=len(data)
  except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):pass
  finally:self._range_remaining=None

 def end_headers(self):
  self.send_header('X-Content-Type-Options','nosniff')
  self.send_header('Cache-Control','no-store')
  super().end_headers()

class Server(socketserver.ThreadingMixIn,http.server.HTTPServer):
 daemon_threads=True
 allow_reuse_address=True

def main():
 p=argparse.ArgumentParser();p.add_argument('--port',type=int,default=4173);p.add_argument('--open',action='store_true');args=p.parse_args()
 with Server(('127.0.0.1',args.port),LibraryHandler) as server:
  url=f'http://127.0.0.1:{args.port}'
  print(f'Wavebox: {url}',flush=True)
  if args.open:webbrowser.open(url)
  try:server.serve_forever()
  except KeyboardInterrupt:pass

if __name__=='__main__':main()
