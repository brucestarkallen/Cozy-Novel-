import copy
import hashlib
import http.client
import json
import pathlib
import sqlite3
import tempfile
import threading
import unittest
from unittest.mock import patch
from server.store import Store,Conflict,validate_backup
from server.relay import endpoint
from serve import NovelServer

def operation(op_id='op1',expected=0,text='Exact 雨 ☕\n  spaces  '):
    blob={'id':'text_'+hashlib.sha256(text.encode()).hexdigest(),'text':text}
    return {'id':op_id,'novelId':'n','libraryId':'lib','libraryGeneration':'g1','expectedServerRevision':expected,'records':[{'id':'n','type':'novel','novelId':'n','libraryId':'lib','title':'Synthetic novel','contentVersion':1,'orderedChapterIds':['c']},{'id':'c','type':'chapter','novelId':'n','orderedSceneIds':['s']},{'id':'s','type':'scene','novelId':'n','chapterId':'c','currentRevisionId':'r'},{'id':'r','type':'revision','novelId':'n','ownerId':'s','parentRevisionId':None,'textBlobId':blob['id']}],'blobs':[blob],'tombstones':[]}

class StoreTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.store=Store(self.temp.name)
    def tearDown(self):self.store.close();self.temp.cleanup()
    def test_conflict_and_lost_ack(self):
        a=operation();ack=self.store.apply('n',a);self.assertEqual(self.store.apply('n',a),ack)
        with self.assertRaises(Conflict):self.store.apply('n',operation('client_b',0,'second version'))
        self.assertEqual(self.store.blob(a['blobs'][0]['id'])['text'],a['blobs'][0]['text']);self.assertEqual(self.store.identity()['serverRevision'],1)
    def test_restore_snapshot_and_old_generation(self):
        a=operation();self.store.apply('n',a);snapshot=self.store.snapshot();backup={'format':'cozyNovel.backup','schemaVersion':1,**snapshot};backup['library']['generation']='g2';ack=self.store.restore(backup,1)
        self.assertTrue((pathlib.Path(self.temp.name)/'backups'/ack['recoverySnapshot']).exists())
        with self.assertRaises(Conflict):self.store.apply('n',a)
        path=pathlib.Path(self.temp.name)/'backups'/ack['recoverySnapshot'];db=sqlite3.connect(path);self.assertEqual(json.loads(db.execute("SELECT value FROM meta WHERE key='generation'").fetchone()[0]),'g1');db.close()
    def test_corrupt_foreign_cross_novel_and_immutable_revision(self):
        self.store.apply('n',operation())
        for b in [{'format':'cozytavern.v1'}, {'format':'cozyNovel.backup','schemaVersion':55}]:
            with self.assertRaises(ValueError):validate_backup(b)
        a=operation('bad',1);a['blobs'][0]['text']='CORRUPTED'
        with self.assertRaises(ValueError):self.store.apply('n',a)
        a=operation('cross',1);a['records'][2]['novelId']='other'
        with self.assertRaises(ValueError):self.store.apply('n',a)
        a=operation('mutate',1,'replacement')
        with self.assertRaises(ValueError):self.store.apply('n',a)
        self.assertEqual(self.store.identity()['serverRevision'],1)
    def test_writes_confined_to_owned_directory(self):
        self.store.apply('n',operation());self.store.backup();paths=list(pathlib.Path(self.temp.name).rglob('*'));self.assertTrue(paths);self.assertTrue(all(p.resolve().is_relative_to(pathlib.Path(self.temp.name)) for p in paths))

class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp=tempfile.TemporaryDirectory();cls.server=NovelServer(('127.0.0.1',0),cls.temp.name);cls.thread=threading.Thread(target=cls.server.serve_forever,daemon=True);cls.thread.start();cls.port=cls.server.server_port
    @classmethod
    def tearDownClass(cls):cls.server.shutdown();cls.server.server_close();cls.temp.cleanup()
    def req(self,path,method='GET',body=None,headers=None):
        c=http.client.HTTPConnection('127.0.0.1',self.port);h={'Origin':f'http://127.0.0.1:{self.port}','Content-Type':'application/json','X-CozyNovel-Session':self.server.token};h.update(headers or {});c.request(method,path,json.dumps(body) if body is not None else None,h);r=c.getresponse();status=r.status;data=r.read();c.close();return status,data
    def test_security_boundaries(self):
        self.assertEqual(self.req('/api/novel/status')[0],200)
        self.assertEqual(self.req('/api/novel/backups','POST',{}, {'Origin':'https://evil.example'})[0],403)
        self.assertEqual(self.req('/api/novel/backups','POST',{}, {'X-CozyNovel-Session':'wrong'})[0],403)
        self.assertEqual(self.req('/api/novel/status',headers={'Host':'evil.example'})[0],403)
        self.assertEqual(self.req('/api/novel/backups','POST',{}, {'Content-Type':'text/plain'})[0],400)
        for path in ['/../serve.py','/%2e%2e/serve.py','/.git/config','/server/store.py','/api/backup','/api/novel/../backup']:
            self.assertEqual(self.req(path)[0],404,path)
    def test_destination_restrictions(self):
        with self.assertRaises(ValueError):endpoint('file:///etc/passwd')
        with self.assertRaises(ValueError):endpoint('http://127.0.0.1:8080/v1/chat/completions')
        with self.assertRaises(ValueError):endpoint('http://127.0.0.1:8081/v1/chat/completions',True,8081)
        with self.assertRaises(ValueError):endpoint('http://127.0.0.1:8899/api/novel/status',True)
        with self.assertRaises(ValueError):endpoint('https://key:secret@example.com/v1/chat/completions')
    def test_secret_separate_from_device_records(self):
        profile={'id':'primary','adapter':'chat','model':'mock','endpoint':'http://127.0.0.1:8899/v1/chat/completions','allowLocal':True,'secret':'SYNTHETIC_SECRET','persistSecret':False,'outputLimit':200}
        status,result=self.req('/api/novel/connections','POST',profile);self.assertEqual(status,200);self.assertNotIn(b'SYNTHETIC_SECRET',result);self.assertNotIn('SYNTHETIC_SECRET',(pathlib.Path(self.temp.name)/'connections.json').read_text());self.assertNotIn(b'SYNTHETIC_SECRET',self.req('/api/novel/status')[1])
        profile['persistSecret']=True;self.req('/api/novel/connections','POST',profile);self.assertEqual((pathlib.Path(self.temp.name)/'connections.json').stat().st_mode&0o777,0o600)

class RelayTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        import subprocess,sys
        cls.provider=subprocess.Popen([sys.executable,'tests/fixtures/provider.py'],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        cls.provider_port=int(cls.provider.stdout.readline().strip())
        cls.temp=tempfile.TemporaryDirectory();cls.server=NovelServer(('127.0.0.1',0),cls.temp.name);threading.Thread(target=cls.server.serve_forever,daemon=True).start()
    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown();cls.server.server_close();cls.provider.terminate();cls.provider.communicate(timeout=5);cls.temp.cleanup()
    def test_all_four_real_relay_serializations_against_mock_upstream(self):
        for adapter in ['responses','chat','anthropic','openrouter']:
            with self.subTest(adapter=adapter):
                profile={'id':'primary','adapter':adapter,'model':'fixture','endpoint':f'http://127.0.0.1:{self.provider_port}/v1/chat/completions','allowLocal':True,'outputLimit':100,'secret':'SYNTHETIC_RELAY_KEY','capabilities':{'usage':True}}
                self.server.profiles.save(profile)
                if adapter=='responses':payload={'model':'fixture','stream':True,'instructions':'Write prose','input':[{'role':'user','content':[{'type':'input_text','text':'A café'}]}],'max_output_tokens':100,'store':False}
                elif adapter=='anthropic':payload={'model':'fixture','stream':True,'system':'Write prose','messages':[{'role':'user','content':'A café'}],'max_tokens':100}
                else:payload={'model':'fixture','stream':True,'messages':[{'role':'system','content':'Write prose'},{'role':'user','content':'A café'}],'max_tokens':100,'stream_options':{'include_usage':True}}
                c=http.client.HTTPConnection('127.0.0.1',self.server.server_port);c.request('POST','/api/novel/generate',json.dumps({'connectionId':'primary','adapter':adapter,'requestId':'request_'+adapter,'request':payload}),{'Origin':f'http://127.0.0.1:{self.server.server_port}','Content-Type':'application/json','X-CozyNovel-Session':self.server.token});r=c.getresponse();data=r.read();self.assertEqual(r.status,200);self.assertIn(b'Rain tapped',data);self.assertNotIn(b'SYNTHETIC_RELAY_KEY',data);c.close()
    def test_source_directory_cannot_hold_device_secrets(self):
        with self.assertRaises(ValueError):NovelServer(('127.0.0.1',0),pathlib.Path('js/device-data'))

class InstallerTests(unittest.TestCase):
    def test_installer_owns_only_its_launcher_and_preserves_foreign_files(self):
        import os,subprocess
        with tempfile.TemporaryDirectory() as directory:
            root=pathlib.Path(directory);launcher=root/'bin'/'cozynovel';sentinel=root/'other_app';sentinel.write_text('untouched')
            environment=dict(os.environ,COZYNOVEL_BIN_DIR=str(root/'bin'))
            first=subprocess.run(['sh','install.sh'],env=environment,capture_output=True,text=True);self.assertEqual(first.returncode,0,first.stderr)
            self.assertIn('# Cozy Novel installed launcher',launcher.read_text());self.assertEqual(sentinel.read_text(),'untouched')
            second=subprocess.run(['sh','install.sh'],env=environment,capture_output=True,text=True);self.assertEqual(second.returncode,0)
            launcher.write_text('foreign launcher')
            rejected=subprocess.run(['sh','install.sh'],env=environment,capture_output=True,text=True);self.assertNotEqual(rejected.returncode,0);self.assertEqual(launcher.read_text(),'foreign launcher')
