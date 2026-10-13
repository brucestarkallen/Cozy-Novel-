"""Transactional device storage. No manuscript ever belongs to another product."""
import hashlib
import json
import os
import sqlite3
import threading
import time
import uuid

def stable(value):
    if isinstance(value,dict):return {k:stable(v) for k,v in sorted(value.items())}
    if isinstance(value,list):return [stable(v) for v in value]
    if isinstance(value,float) and value.is_integer():return int(value)
    return value

def content_digest(value):return "text_"+hashlib.sha256(json.dumps(stable(value),ensure_ascii=False,separators=(",",":")).encode()).hexdigest()
from pathlib import Path

TYPES = {'novel', 'chapter', 'scene', 'revision', 'candidate', 'entity', 'canon', 'exploration', 'turn', 'artifact', 'job', 'receipt', 'discussion', 'prompt', 'bookmark'}
class Conflict(ValueError): pass

def validate_backup(data):
    if not isinstance(data, dict) or data.get('format') != 'cozyNovel.backup' or data.get('schemaVersion') != 1:
        raise ValueError('Unsupported Cozy Novel backup. No data was changed.')
    library = data.get('library', {})
    if not library.get('id') or not library.get('generation'):
        raise ValueError('Missing library identity.')
    if data.get('configuration'):
        if data['configuration'].get('version')!=1:raise ValueError('Unsupported future configuration format.')
        def inspect(value):
            if isinstance(value,dict):
                for key,item in value.items():
                    if key in {'secret','apiKey','accessToken','sessionToken','token','authorization'}:raise ValueError('Credentials are not permitted in portable backups.')
                    inspect(item)
            elif isinstance(value,list):
                for item in value:inspect(item)
        inspect(data['configuration'])
    records = data.get('records'); blobs = data.get('blobs')
    if not isinstance(records, list) or not isinstance(blobs, list): raise ValueError('Missing backup records.')
    rm = {r['id']: r for r in records}; bm = {b['id']: b for b in blobs}
    if len(rm) != len(records) or len(bm) != len(blobs): raise ValueError('Duplicate record identities.')
    for b in blobs: validate_blob(b)
    validate_graph(records, rm.get, bm.get, library['id'])
    for r in records:
        if r['type']=='revision':
            seen=set();cursor=r
            while cursor:
                if cursor['id'] in seen:raise ValueError('Cyclic revision history.')
                seen.add(cursor['id']);cursor=rm.get(cursor.get('parentRevisionId'))
        if r['type']=='exploration':
            branches={b['id']:b for b in r.get('branches',[])}
            if len(branches)!=len(r.get('branches',[])) or r.get('activeBranchId') not in branches:raise ValueError('Invalid exploration branches.')
            text=bm[rm[r['baseRevisionId']]['textBlobId']]['text']
            if not isinstance(r.get('boundary'),int) or not 0<=r['boundary']<=len(text.encode('utf-16-le'))//2:raise ValueError('Invalid exploration boundary.')
            for branch in branches.values():
                seen=set();cursor=branch
                while cursor:
                    if cursor['id'] in seen:raise ValueError('Cyclic exploration branch.')
                    seen.add(cursor['id'])
                    if not isinstance(cursor.get('forkSequence'),int) or cursor['forkSequence']<0:raise ValueError('Invalid branch sequence.')
                    if not cursor.get('parentId'):break
                    cursor=branches.get(cursor['parentId'])
                    if not cursor:raise ValueError('Missing parent branch.')
        if r['type']=='turn':
            ex=rm[r['parentSessionId']]
            if r.get('branchId') not in {b['id'] for b in ex['branches']} or not isinstance(r.get('sequence'),int) or r['sequence']<=0:raise ValueError('Invalid exploration turn.')
    return data

def validate_blob(b):
    if not isinstance(b.get('text'), str) or b.get('id') != 'text_' + hashlib.sha256(b['text'].encode()).hexdigest():
        raise ValueError('Invalid text checksum.')

def validate_graph(records, get_record, get_blob, library_id):
    def ref(key, kind=None, novel=None):
        r = get_record(key)
        if not r or (kind and r['type'] != kind) or (novel and r['novelId'] != novel):
            raise ValueError('Missing or foreign record reference.')
        return r
    for r in records:
        if not isinstance(r.get('id'), str) or len(r['id']) > 160 or r.get('type') not in TYPES:
            raise ValueError('Invalid record shape.')
        saved=r.get('baseContextRecords') or (r.get('body',{}).get('records') if r.get('kind')=='explorationBase' else None)
        if saved is not None and (not isinstance(saved,list) or any(x.get('novelId')!=r['novelId'] or x.get('type') not in TYPES for x in saved)):raise ValueError('Invalid exploration baseline ownership.')
        if r.get('coveredTurnIds') is not None and (not isinstance(r['coveredTurnIds'],list) or any(not isinstance(x,str) for x in r['coveredTurnIds'])):raise ValueError('Invalid transcript coverage.')
        for field in ('validFrom','validUntil','fictionalTime'):
            if r.get(field) is not None and (not isinstance(r[field],(int,float)) or not __import__('math').isfinite(r[field])):raise ValueError('Invalid fictional time.')
        if r.get('validFrom') is not None and r.get('validUntil') is not None and r['validUntil']<=r['validFrom']:raise ValueError('Expiry must follow its start.')
        if r['type']=='job' and r.get('outputType') is not None and r['outputType'] not in {'worldResponse','sourceReading','eventProposal','discussion','proseCandidate','authorGuidance','craftReview','sourceSelection'}:raise ValueError('Invalid job output ownership.')
        n = ref(r.get('novelId'), 'novel')
        if n.get('libraryId') != library_id: raise ValueError('Wrong library ownership.')
        if r.get('textBlobId') and not get_blob(r['textBlobId']): raise ValueError('Missing text body.')
        if r['type'] == 'novel':
            if n['id'] != n['novelId'] or not isinstance(n.get('contentVersion'), int): raise ValueError('Invalid novel.')
            for k in r['orderedChapterIds']: ref(k, 'chapter', n['id'])
        if r['type'] == 'chapter':
            for k in r['orderedSceneIds']:
                if ref(k, 'scene', n['id'])['chapterId'] != r['id']: raise ValueError('Wrong chapter ownership.')
        if r['type'] == 'scene':
            ref(r['chapterId'], 'chapter', n['id'])
            seen={r['id']};prior=r.get('continuationOf')
            while prior:
                if prior in seen:raise ValueError('Cyclic scene continuation.')
                seen.add(prior);prior=ref(prior,'scene',n['id']).get('continuationOf')
            if ref(r['currentRevisionId'], 'revision', n['id'])['ownerId'] != r['id']: raise ValueError('Wrong revision ownership.')
        if r['type'] == 'revision':
            ref(r['ownerId'], 'scene', n['id'])
            if r.get('parentRevisionId') and ref(r['parentRevisionId'], 'revision', n['id'])['ownerId'] != r['ownerId']: raise ValueError('Wrong revision ancestry.')
        for field, kind in [('baseContextId','artifact'),('baseRevisionId','revision'),('sceneId','scene'),('baseSceneId','scene'),('parentSessionId','exploration'),('explorationId','exploration'),('holderId','entity'),('subjectId','entity'),('playerCharacterId','entity'),('actorId','entity')]:
            if r.get(field): ref(r[field],kind,n['id'])
        for s in r.get('sourceRefs',[]):
            ref(s['id'],novel=n['id'])
            if s.get('revisionId'): ref(s['revisionId'],'revision',n['id'])
        if r['type'] == 'candidate':
            rev = ref(r['baseRevisionId'],'revision',n['id']); text = get_blob(rev['textBlobId'])['text']; bounds=r['insertionRange']
            # Browser offsets are UTF16 code units, including astral Unicode characters.
            raw=text.encode('utf-16-le','surrogatepass')
            if len(bounds)!=2 or any(not isinstance(x,int) for x in bounds) or not 0<=bounds[0]<=bounds[1]<=len(raw)//2: raise ValueError('Invalid candidate range.')
            selection=raw[bounds[0]*2:bounds[1]*2].decode('utf-16-le','surrogatepass')
            if rev['ownerId']!=r['sceneId'] or selection!=r['originalSelection']: raise ValueError('Candidate source mismatch.')

class Store:
    def __init__(self, directory):
        self.directory=Path(directory).expanduser().resolve(); self.directory.mkdir(parents=True,exist_ok=True,mode=0o700)
        os.chmod(self.directory,0o700)
        self.lock=threading.RLock(); self.path=self.directory/'library.sqlite3'
        self.db=sqlite3.connect(self.path,check_same_thread=False,isolation_level=None)
        self.db.execute('PRAGMA journal_mode=WAL'); self.db.execute('PRAGMA synchronous=FULL')
        self.db.executescript('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, type TEXT NOT NULL, novel TEXT NOT NULL, body TEXT NOT NULL); CREATE INDEX IF NOT EXISTS records_novel ON records(novel); CREATE INDEX IF NOT EXISTS records_type ON records(type); CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, text TEXT NOT NULL); CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, ack TEXT NOT NULL);')
        self.db.execute('CREATE TABLE IF NOT EXISTS restore_operations (id TEXT PRIMARY KEY, digest TEXT NOT NULL, snapshot TEXT NOT NULL, expected_revision INTEGER NOT NULL, phase TEXT NOT NULL, created_at REAL NOT NULL, ack TEXT)')
        if 'digest' not in {row[1] for row in self.db.execute('PRAGMA table_info(operations)')}:self.db.execute('ALTER TABLE operations ADD COLUMN digest TEXT')
        os.chmod(self.path,0o600)
        version=self.meta('schemaVersion')
        if version is not None and version!=1: self.db.close(); raise ValueError('Unsupported device schema. Use compatible application code.')
        if version is None: self.set_meta('schemaVersion',1)
    def meta(self,key):
        row=self.db.execute('SELECT value FROM meta WHERE key=?',(key,)).fetchone();return json.loads(row[0]) if row else None
    def set_meta(self,key,value): self.db.execute('INSERT OR REPLACE INTO meta VALUES (?,?)',(key,json.dumps(value)))
    def identity(self):
        with self.lock: return {'service':'cozyNovel','protocol':1,'syncVersion':3,'minimumWriter':3,'schemaVersion':1,'libraryId':self.meta('libraryId'),'generation':self.meta('generation'),'serverRevision':self.meta('serverRevision') or 0}
    def record(self,key):
        row=self.db.execute('SELECT body FROM records WHERE id=?',(key,)).fetchone();return json.loads(row[0]) if row else None
    def blob(self,key):
        row=self.db.execute('SELECT text FROM blobs WHERE id=?',(key,)).fetchone();return {'id':key,'text':row[0]} if row else None
    def apply(self,novel_id,op):
        if op.get('novelId')!=novel_id or not all(isinstance(op.get(k),str) and op[k] for k in ['id','libraryId','libraryGeneration']):raise ValueError('Invalid operation ownership.')
        if not isinstance(op.get('records'),list) or not isinstance(op.get('blobs'),list) or op.get('tombstones'):raise ValueError('Invalid operation. Archive records rather than deleting them.')
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            try:
                identity=self.identity()
                if identity['libraryId'] and (identity['libraryId']!=op['libraryId'] or identity['generation']!=op['libraryGeneration']):raise Conflict('Library generation conflict. Both libraries are retained.')
                prior=self.db.execute('SELECT ack,digest FROM operations WHERE id=?',(op['id'],)).fetchone()
                if prior:
                    if prior[1] and prior[1] not in {content_digest(op),content_digest(dict(op,clientProtocol=2)) if op.get('clientProtocol')==3 else content_digest(op)}:raise Conflict('Operation identity was reused with different contents.')
                    ack=json.loads(prior[0]);ack.update({'libraryId':op['libraryId'],'expectedServerRevision':ack['serverRevision']-1});self.db.execute('COMMIT');return ack
                if op.get('clientProtocol')!=3:raise Conflict('Refresh Cozy Novel before saving to this service. Your visible local work remains intact.')
                if op.get('expectedServerRevision')!=identity['serverRevision']:raise Conflict('Device revision conflict. Your local version is retained.')
                rm={r['id']:r for r in op['records']};bm={b['id']:b for b in op['blobs']}
                if len(rm)!=len(op['records']) or len(bm)!=len(op['blobs']):raise ValueError('Duplicate operation records.')
                for b in op['blobs']:validate_blob(b)
                for r in op['records']:
                    if r.get('novelId')!=novel_id:raise ValueError('Cross novel operation rejected.')
                    old=self.record(r['id'])
                    if old and (old['novelId']!=novel_id or old['type']!=r['type']):raise ValueError('Record identity collision.')
                    if old and r['type']=='revision' and old!=r:raise ValueError('Text revision metadata is immutable.')
                validate_graph(op['records'],lambda k:rm.get(k) or self.record(k),lambda k:bm.get(k) or self.blob(k),op['libraryId'])
                for b in op['blobs']:self.db.execute('INSERT OR IGNORE INTO blobs VALUES (?,?)',(b['id'],b['text']))
                for r in op['records']:self.db.execute('INSERT OR REPLACE INTO records VALUES (?,?,?,?)',(r['id'],r['type'],r['novelId'],json.dumps(r,ensure_ascii=False)))
                revision=identity['serverRevision']+1
                self.set_meta('libraryId',op['libraryId']);self.set_meta('generation',op['libraryGeneration']);self.set_meta('serverRevision',revision)
                ack={'operationId':op['id'],'serverRevision':revision,'libraryGeneration':op['libraryGeneration'],'libraryId':op['libraryId'],'expectedServerRevision':identity['serverRevision']}
                self.db.execute('INSERT INTO operations (id,ack,digest) VALUES (?,?,?)',(op['id'],json.dumps(ack),content_digest(op)));self.db.execute('COMMIT');return ack
            except BaseException:self.db.execute('ROLLBACK');raise
    def projects(self,cursor=0):
        with self.lock:
            rows=self.db.execute("SELECT body FROM records WHERE type='novel' ORDER BY id LIMIT 100 OFFSET ?",(cursor,)).fetchall();return {'projects':[json.loads(r[0]) for r in rows],'nextCursor':cursor+100 if len(rows)==100 else None}
    def snapshot(self,cursor=0,novel_id=None):
        with self.lock:
            where=' WHERE novel=?' if novel_id else '';args=(novel_id,) if novel_id else ()
            rows=self.db.execute('SELECT body FROM records'+where+' ORDER BY id LIMIT 200 OFFSET ?',args+(cursor,)).fetchall()
            records=[json.loads(r[0]) for r in rows];keys={r.get('textBlobId') for r in records if r.get('textBlobId')}
            return {'library':{'id':self.meta('libraryId'),'generation':self.meta('generation'),'activeProjectId':None},'records':records,'blobs':[self.blob(k) for k in keys],'nextCursor':cursor+200 if len(rows)==200 else None,'serverRevision':self.meta('serverRevision') or 0}
    def backup(self):
        with self.lock:
            folder=self.directory/'backups';folder.mkdir(exist_ok=True,mode=0o700)
            path=folder/('snapshot_'+str(time.time_ns())+'.sqlite3')
            target=sqlite3.connect(path);self.db.backup(target);target.close();os.chmod(path,0o600);return path.name
    def manifest(self,cursor=0):
        with self.lock:
            rows=self.db.execute('SELECT body FROM records ORDER BY id LIMIT 200 OFFSET ?',(cursor,)).fetchall()
            return {'serverRevision':self.meta('serverRevision') or 0,'records':[{'id':json.loads(r[0])['id'],'hash':content_digest(json.loads(r[0]))} for r in rows],'nextCursor':cursor+200 if len(rows)==200 else None}
    def prepare_restore(self,operation_id,snapshot_digest,snapshot_json):
        if not isinstance(operation_id,str) or not operation_id.startswith('restore_'):raise ValueError('Missing stable restore identity.')
        if 'text_'+hashlib.sha256(snapshot_json.encode()).hexdigest()!=snapshot_digest:raise ValueError('Restore digest mismatch.')
        data=validate_backup(json.loads(snapshot_json))
        with self.lock:
            prior=self.db.execute('SELECT digest,expected_revision,phase FROM restore_operations WHERE id=?',(operation_id,)).fetchone()
            if prior:
                if prior[0]!=snapshot_digest:raise Conflict('Restore identity was reused with different contents.')
                return {'previewId':operation_id,'restoreOperationId':operation_id,'snapshotDigest':snapshot_digest,'serverRevision':prior[1],'phase':prior[2],'titles':[r['title'] for r in data['records'] if r['type']=='novel']}
            expected=self.meta('serverRevision') or 0
            self.db.execute('INSERT INTO restore_operations VALUES (?,?,?,?,?,?,?)',(operation_id,snapshot_digest,snapshot_json,expected,'prepared',time.time(),None))
            return {'previewId':operation_id,'restoreOperationId':operation_id,'snapshotDigest':snapshot_digest,'serverRevision':expected,'titles':[r['title'] for r in data['records'] if r['type']=='novel']}
    def restore_outcome(self,operation_id):
        with self.lock:
            row=self.db.execute('SELECT phase,created_at,ack FROM restore_operations WHERE id=?',(operation_id,)).fetchone()
            if not row:return {'phase':'unknown'}
            return {'phase':'expired' if row[0]=='prepared' and time.time()-row[1]>600 else row[0],'ack':json.loads(row[2]) if row[2] else None}
    def commit_restore(self,operation_id,snapshot_digest,expected_revision):
        with self.lock:
            row=self.db.execute('SELECT digest,snapshot,expected_revision,phase,created_at,ack FROM restore_operations WHERE id=?',(operation_id,)).fetchone()
            if not row:raise ValueError('Unknown restore preview. No replacement was performed.')
            if row[0]!=snapshot_digest:raise Conflict('Restore identity was reused with different contents.')
            if row[3]=='committed':return json.loads(row[5])
            if time.time()-row[4]>600:raise ValueError('Restore preview expired.')
            if row[2]!=expected_revision or (self.meta('serverRevision') or 0)!=expected_revision:raise Conflict('Device changed after the restore preview.')
            data=validate_backup(json.loads(row[1]));snapshot=self.backup()
            self.db.execute('BEGIN IMMEDIATE')
            try:
                # SQLite also fences another process that may share this explicitly configured directory.
                if (self.meta('serverRevision') or 0)!=expected_revision:raise Conflict('Device changed before restore commit.')
                for table in ['records','blobs','operations']:self.db.execute('DELETE FROM '+table)
                for b in data['blobs']:self.db.execute('INSERT INTO blobs VALUES (?,?)',(b['id'],b['text']))
                for r in data['records']:self.db.execute('INSERT INTO records VALUES (?,?,?,?)',(r['id'],r['type'],r['novelId'],json.dumps(r,ensure_ascii=False)))
                self.set_meta('libraryId',data['library']['id']);self.set_meta('generation',data['library']['generation']);self.set_meta('serverRevision',expected_revision+1)
                ack={'restoreOperationId':operation_id,'snapshotDigest':snapshot_digest,'libraryId':data['library']['id'],'libraryGeneration':data['library']['generation'],'serverRevision':expected_revision+1,'recoverySnapshot':snapshot}
                self.db.execute('UPDATE restore_operations SET phase=?,ack=? WHERE id=?',('committed',json.dumps(ack),operation_id))
                self.db.execute('COMMIT');return ack
            except BaseException:self.db.execute('ROLLBACK');raise
    def restore(self,data,expected_revision):
        wire=json.dumps(data,ensure_ascii=False);key='restore_'+str(uuid.uuid4());digest='text_'+hashlib.sha256(wire.encode()).hexdigest()
        self.prepare_restore(key,digest,wire);return self.commit_restore(key,digest,expected_revision)
    def close(self):self.db.close()
