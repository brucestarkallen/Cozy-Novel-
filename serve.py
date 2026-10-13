#!/usr/bin/env python3
"""Run the independent Cozy Novel studio on loopback."""
import argparse
import json
import mimetypes
import secrets
import socket
import sys
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote,urlsplit,parse_qs
from server.store import Store,Conflict,validate_backup
from server.relay import Profiles

ROOT=Path(__file__).resolve().parent
class NovelServer(ThreadingHTTPServer):
    daemon_threads=True
    allow_reuse_address=True
    def __init__(self,address,directory):
        if Path(directory).expanduser().resolve().is_relative_to(ROOT):raise ValueError('Device data must be outside the application source directory.')
        super().__init__(address,Handler);self.store=Store(directory);self.token=secrets.token_urlsafe(32);self.profiles=Profiles(self.store.directory,self.server_port);self.previews={};self.active={};self.guard=threading.RLock()
    def server_close(self):
        super().server_close()
        if hasattr(self,'store'):self.store.close()

class Handler(BaseHTTPRequestHandler):
    protocol_version='HTTP/1.1'
    def log_message(self,*args):pass
    def allowed(self,mutation=False):
        port=self.server.server_port
        hosts={f'127.0.0.1:{port}',f'localhost:{port}'}
        if self.headers.get('Host') not in hosts:raise PermissionError('Unexpected Host.')
        origin=self.headers.get('Origin')
        if origin and origin not in {'http://'+h for h in hosts}:raise PermissionError('Unexpected Origin.')
        if self.headers.get('Sec-Fetch-Site')=='cross-site':raise PermissionError('Cross origin request rejected.')
        if mutation:
            if origin not in {'http://'+h for h in hosts}:raise PermissionError('A local application Origin is required.')
            if not secrets.compare_digest(self.headers.get('X-CozyNovel-Session',''),self.server.token):raise PermissionError('Application session token required.')
            if self.headers.get('Content-Type','').split(';')[0]!='application/json':raise ValueError('Use JSON content type.')
    def send(self,status,body,content_type='application/json'):
        data=json.dumps(body).encode() if content_type=='application/json' else body
        self.send_response(status);self.send_header('Content-Type',content_type);self.send_header('Content-Length',str(len(data)));self.send_header('Cache-Control','no-store' if self.path.startswith('/api/') else 'no-cache');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer');self.send_header('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");self.end_headers();self.wfile.write(data)
    def body(self):
        size=int(self.headers.get('Content-Length','0'));limit=64*1024*1024 if '/restore/' in self.path else 8*1024*1024
        if size<=0 or size>limit:raise ValueError('Request is empty or exceeds its size limit.')
        return json.loads(self.rfile.read(size))
    def do_OPTIONS(self):self.send(403,{'error':'Cross origin access is disabled.'})
    def do_GET(self):self.handle_request(False)
    def do_POST(self):self.handle_request(True)
    def handle_request(self,mutation):
        try:
            self.allowed(mutation);url=urlsplit(self.path);path=unquote(url.path);query=parse_qs(url.query)
            if path.startswith('/api/novel/'):
                route=path[len('/api/novel/'):];data=self.body() if mutation else None
                if route=='status' and not mutation:self.send(200,self.server.store.identity()|{'sessionToken':self.server.token,'connections':self.server.profiles.public()});return
                if route=='projects' and not mutation:self.send(200,self.server.store.projects(max(0,int(query.get('cursor',['0'])[0]))));return
                if route=='snapshot' and not mutation:self.send(200,self.server.store.snapshot(max(0,int(query.get('cursor',['0'])[0]))));return
                if route.startswith('projects/'):
                    parts=route.split('/')
                    if len(parts)==3 and parts[2]=='operations' and mutation:self.send(200,self.server.store.apply(parts[1],data));return
                    if len(parts)==2 and not mutation:self.send(200,self.server.store.snapshot(max(0,int(query.get('cursor',['0'])[0])),parts[1]));return
                if route=='connections' and mutation:self.send(200,self.server.profiles.save(data));return
                if route=='backups' and mutation:self.send(200,{'snapshot':self.server.store.backup()});return
                if route=='manifest' and not mutation:self.send(200,self.server.store.manifest(max(0,int(query.get('cursor',['0'])[0]))));return
                if route.startswith('restore/operations/') and not mutation:self.send(200,self.server.store.restore_outcome(route.split('/')[-1]));return
                if route=='restore/preview' and mutation:
                    if data.get('clientProtocol')!=2:raise Conflict('Refresh Cozy Novel for safe restore coordination.')
                    self.send(200,self.server.store.prepare_restore(data['restoreOperationId'],data['snapshotDigest'],data['snapshotJson']));return
                if route=='restore/commit' and mutation:
                    if data.get('clientProtocol')!=2:raise Conflict('Refresh Cozy Novel for safe restore coordination.')
                    self.send(200,self.server.store.commit_restore(data['restoreOperationId'],data['snapshotDigest'],data['expectedServerRevision']));return
                if route=='cancel' and mutation:
                    with self.server.guard:conn=self.server.active.get(data.get('requestId'))
                    if conn:
                        try:conn.sock.shutdown(socket.SHUT_RDWR)
                        except (OSError,AttributeError):pass
                        conn.close()
                    self.send(200,{'cancelRequested':bool(conn)});return
                if route=='generate' and mutation:self.generate(data);return
                self.send(404,{'error':'Unknown Cozy Novel endpoint.'});return
            if mutation:self.send(405,{'error':'Method not allowed.'});return
            relative=path.lstrip('/') or 'index.html'
            target=(ROOT/relative).resolve()
            if '..' in Path(relative).parts or not target.is_relative_to(ROOT) or not (relative in {'index.html','manifest.webmanifest','sw.js'} or relative.startswith(('js/','css/','assets/'))) or not target.is_file():
                self.send(404,{'error':'Application asset not found.'});return
            self.send(200,target.read_bytes(),mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
        except Conflict as e:self.send(409,{'error':str(e)})
        except PermissionError as e:self.send(403,{'error':str(e)})
        except (ValueError,KeyError,TypeError,OverflowError) as e:self.send(400,{'error':str(e) if isinstance(e,ValueError) else 'Invalid request shape.'})
        except (BrokenPipeError,ConnectionResetError):pass
        except Exception:self.send(500,{'error':'Local service could not complete this operation. Your browser copy is retained.'})
    def generate(self,data):
        request_id=data.get('requestId')
        if not isinstance(request_id,str):raise ValueError('Missing request identity.')
        with self.server.guard:
            if request_id in self.server.active:raise Conflict('Request is already running.')
            self.server.active[request_id]=None
        conn=None
        try:
            conn,response=self.server.profiles.request(data.get('connectionId'),data.get('adapter'),data.get('request',{}))
            with self.server.guard:self.server.active[request_id]=conn
            self.send_response(200);self.send_header('Content-Type','text/event-stream');self.send_header('Cache-Control','no-store');self.send_header('Connection','close');self.send_header('X-Content-Type-Options','nosniff');self.end_headers();self.close_connection=True
            try:
                while True:
                    chunk=response.read1(8192)
                    if not chunk:break
                    self.wfile.write(chunk);self.wfile.flush()
            except (OSError,TimeoutError):pass
        finally:
            if conn:conn.close()
            with self.server.guard:self.server.active.pop(request_id,None)

def main():
    if sys.version_info<(3,11):raise SystemExit('Cozy Novel requires Python 3.11 or newer.')
    parser=argparse.ArgumentParser(description='Cozy Novel local writing studio')
    parser.add_argument('--port',type=int,default=8081);parser.add_argument('--data-dir',default=str(Path.home()/'.cozynovel'))
    args=parser.parse_args()
    if not 1<=args.port<=65535:parser.error('Choose a valid explicit port.')
    try:server=NovelServer(('127.0.0.1',args.port),args.data_dir)
    except OSError as e:
        try:
            with urllib.request.urlopen(f'http://127.0.0.1:{args.port}/api/novel/status',timeout=2) as response: identity=json.load(response)
            if identity.get('service')=='cozyNovel' and identity.get('protocol')==1:
                print(f'Cozy Novel is already running at http://127.0.0.1:{args.port}',flush=True)
                return
        except (OSError,ValueError):pass
        raise SystemExit(f'Cannot open Cozy Novel port {args.port}. Another process may own it. No process was stopped. Use --port with an explicit alternative.') from e
    print(f'Cozy Novel is ready at http://127.0.0.1:{args.port}',flush=True)
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()
if __name__=='__main__':main()
