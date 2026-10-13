"""Novel owned connection profiles. Configuration saving never contacts a provider."""
import copy
import http.client
import hashlib
import ipaddress
import json
import math
import os
import re
import socket
import ssl
import threading
import time
import uuid
from urllib.parse import urlsplit, urlunsplit

ADAPTERS = {'responses','chat','anthropic','openrouter'}
class ProviderError(ValueError):
    def __init__(self, message, code='provider_error', status=None, parameter=None):
        super().__init__(message); self.code=code; self.status=status; self.parameter=parameter

def syntax_endpoint(value, allow_local=False, own_port=8081):
    if not isinstance(value,str) or any(ord(c)<32 for c in value):raise ValueError('Invalid provider endpoint.')
    try:
        u=urlsplit(value); port=u.port or (443 if u.scheme=='https' else 80)
    except (ValueError,TypeError): raise ValueError('Invalid provider endpoint.')
    if u.scheme not in {'http','https'} or not u.hostname or u.username or u.password or u.query or u.fragment: raise ValueError('Invalid provider endpoint.')
    if u.scheme=='http' and not (allow_local and u.hostname in {'localhost','127.0.0.1','::1'} and port!=own_port): raise ValueError('Remote providers require verified HTTPS. Local HTTP needs explicit loopback permission.')
    if allow_local and not u.path.startswith(('/v1/','/api/chat','/api/generate','/beta/')): raise ValueError('Use an explicit local model API path.')
    return u

def endpoint(value,allow_local=False,own_port=8081):
    u=syntax_endpoint(value,allow_local,own_port); port=u.port or (443 if u.scheme=='https' else 80)
    try: addresses=socket.getaddrinfo(u.hostname,port,type=socket.SOCK_STREAM)
    except socket.gaierror: raise ProviderError('Provider DNS lookup failed. Configuration is retained.', 'dns_failure')
    for item in addresses:
        ip=ipaddress.ip_address(item[4][0])
        if not ip.is_global and not (allow_local and ip.is_loopback and port!=own_port): raise ValueError('This relay destination is not allowed. Local permission allows loopback only.')
    if u.scheme!='https' and not all(ipaddress.ip_address(a[4][0]).is_loopback for a in addresses): raise ValueError('Remote providers require verified HTTPS.')
    return u,addresses

def public_profile(p,secrets):
    return {k:copy.deepcopy(v) for k,v in p.items() if k not in {'secret','secretFromId'}} | {'profileVersion':p.get('profileVersion',0),'hasSecret':bool(secrets.get(p.get('secretReference'),{}).get('value'))}

def atomic_json(path,data):
    temp=path.with_name(path.name+'.'+uuid.uuid4().hex+'.tmp')
    try:
        fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f: json.dump(data,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
        os.replace(temp,path);os.chmod(path,0o600)
        fd=os.open(path.parent,os.O_RDONLY)
        try: os.fsync(fd)
        finally: os.close(fd)
    finally:
        if temp.exists(): temp.unlink()

class Profiles:
    def __init__(self,directory,port):
        self.path=directory/'connections.json';self.port=port;self.items={};self.secrets={};self.warning=None;self.guard=threading.RLock()
        if self.path.exists():
            if os.stat(self.path).st_mode & 0o077: raise ValueError('Connection file permissions must be 600.')
            try: raw=json.loads(self.path.read_text())
            except ValueError: raw=None
            if isinstance(raw,dict) and 'version' in raw and raw['version']!=2: raise ValueError('Unsupported future connection format. Existing configuration was not modified.')
            try: self.load(raw)
            except (ValueError,TypeError,KeyError):
                # Keep the damaged owned file for recovery, and try the last atomic predecessor.
                atomic_json(self.path.with_name('connections.corrupt.'+hashlib.sha256(self.path.read_bytes()).hexdigest()[:16]+'.json'), {'unparsed':self.path.read_text()})
                previous=self.path.with_name('connections.previous.json')
                try:
                    if os.stat(previous).st_mode & 0o077: raise ValueError('Unsafe recovery permissions')
                    recovered=json.loads(previous.read_text())
                    if recovered.get('version')==2:recovered['secrets']={}
                    else:
                        for item in recovered.values():
                            if isinstance(item,dict):item.pop('secret',None)
                    self.load(recovered)
                except (OSError,ValueError,TypeError,KeyError): self.items={};self.secrets={}
                self.warning='Connection configuration was damaged. The original was retained in the Novel data directory. Review recovered profiles before use.'
    def load(self,data):
        if not isinstance(data,dict): raise ValueError('Invalid connection file')
        if data.get('version')==2:
            if not isinstance(data.get('profiles'),dict) or not isinstance(data.get('secrets'),dict): raise ValueError('Invalid connection file')
            items=data['profiles'];secrets=data['secrets']
            for k,p in items.items():
                if not isinstance(p,dict) or p.get('id')!=k or p.get('adapter') not in ADAPTERS: raise ValueError('Invalid profile')
            for v in secrets.values():
                if not isinstance(v,dict) or not isinstance(v.get('value'),str): raise ValueError('Invalid secret reference')
            self.items=items;self.secrets=secrets
        elif 'version' in data: raise ValueError('Unsupported future connection format')
        else:
            # Stable legacy IDs continue to resolve old receipts. Preserve the old configuration before migration.
            items={};secrets={}
            for k,p in data.items():
                if not isinstance(p,dict) or p.get('adapter') not in ADAPTERS: raise ValueError('Invalid legacy profile')
                q={a:b for a,b in p.items() if a!='secret'};q.update(id=k,displayName='Writing connection' if k=='primary' else 'Helper connection',preset='custom',transport='relay')
                ref='secret_'+uuid.uuid4().hex;q['secretReference']=ref
                if p.get('secret'): secrets[ref]={'value':p['secret'],'persist':bool(p.get('persistSecret'))}
                items[k]=q
            legacy=self.path.with_name('connections.legacy.json')
            if not legacy.exists(): atomic_json(legacy,data)
            self.persist(items,secrets);self.items=items;self.secrets=secrets
    def public(self):
        with self.guard: return [public_profile(p,self.secrets) for p in self.items.values()]
    def persist(self,items,secrets):
        data={'version':2,'profiles':items,'secrets':{k:v for k,v in secrets.items() if v.get('persist')}}
        if self.path.exists():
            try: old=json.loads(self.path.read_text())
            except (ValueError,OSError): old=None
            if old is not None:
                if old.get('version')==2:old['secrets']={k:v for k,v in old.get('secrets',{}).items() if k in data['secrets']}
                atomic_json(self.path.with_name('connections.previous.json'),old)
        atomic_json(self.path,data)
    def save(self,p):
        if not isinstance(p,dict) or not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',p.get('id','')) or p.get('adapter') not in ADAPTERS or not isinstance(p.get('model'),str): raise ValueError('Invalid connection profile.')
        syntax_endpoint(p.get('endpoint',''),bool(p.get('allowLocal')),self.port)
        if p.get('secret') and (not isinstance(p['secret'],str) or len(p['secret'])>8192 or any(ord(c)<32 for c in p['secret'])):raise ValueError('An API key must be a single line without control characters.')
        allowed={'id','displayName','preset','adapter','transport','baseUrl','endpoint','model','contextLimit','outputLimit','reasoningReserve','capabilityConfirmed','capabilities','parameters','inputPrice','outputPrice','cachedPrice','cacheWritePrice','persistSecret','allowLocal','prefill','prefillMode','prefillTemplate','prefillMinChars','prefillBanned','reasoningStyle','reasoningLevels','thinkingBudget','thinkingMode','searchOn','searchMaxUses','promptCache','health','lastTest','observations','discovery','contextOverride','outputOverride','capabilityOverrides','reasoningLevelsOverride'}
        clean={k:copy.deepcopy(v) for k,v in p.items() if k in allowed}
        clean.setdefault('contextLimit',32000);clean.setdefault('outputLimit',2000)
        for key in ('contextLimit','outputLimit'):
            if not isinstance(clean.get(key),int) or not 1<=clean[key]<=2000000: raise ValueError('Invalid context or output limit.')
        if clean['outputLimit']>=clean['contextLimit']: raise ValueError('Output must fit in the context window.')
        if not isinstance(clean.get('parameters',{}),dict) or not isinstance(clean.get('capabilities',{}),dict): raise ValueError('Invalid model settings.')
        for key in ('inputPrice','outputPrice','cachedPrice','cacheWritePrice'):
            if clean.get(key) is not None and (not isinstance(clean[key],(int,float)) or isinstance(clean[key],bool) or not math.isfinite(clean[key]) or clean[key]<0):raise ValueError('Prices must be finite nonnegative numbers or left unknown.')
        for key in ('persistSecret','allowLocal','capabilityConfirmed','searchOn','promptCache'):
            if key in clean and not isinstance(clean[key],bool):raise ValueError('Invalid connection preference.')
        if any(not isinstance(v,bool) for v in clean.get('capabilities',{}).values()):raise ValueError('Capability flags must be booleans.')
        if clean.get('reasoningReserve') is not None and (not isinstance(clean['reasoningReserve'],int) or isinstance(clean['reasoningReserve'],bool) or clean['reasoningReserve']<0):raise ValueError('Invalid reasoning reserve.')
        for value in clean.get('parameters',{}).values():
            if not (isinstance(value,(int,float,str,list)) and not isinstance(value,bool)): raise ValueError('Invalid parameter value.')
        if clean.get('transport','relay') not in {'relay','direct'}: raise ValueError('Choose an explicit transport mode.')
        with self.guard:
            items=copy.deepcopy(self.items);secrets=copy.deepcopy(self.secrets);old=items.get(p['id'],{})
            if old and p.get('profileVersion') is not None and p['profileVersion']!=old.get('profileVersion',0):raise ValueError('This connection changed in another client. Your form is retained. Reopen the current profile or save a separate copy.')
            clean['profileVersion']=old.get('profileVersion',0)+1
            ref=old.get('secretReference') if urlsplit(old.get('endpoint','')).netloc==urlsplit(p['endpoint']).netloc else None
            if p.get('secretFromId'):
                origin=items.get(p['secretFromId'],{})
                if urlsplit(origin.get('endpoint','')).netloc!=urlsplit(p['endpoint']).netloc: raise ValueError('A shared credential requires the same provider origin.')
                ref=origin.get('secretReference')
            if not ref: ref='secret_'+uuid.uuid4().hex
            if p.get('secret'):
                # Editing a shared credential creates a new reference, preserving the other profiles.
                ref='secret_'+uuid.uuid4().hex;secrets[ref]={'value':p['secret'],'persist':bool(clean.get('persistSecret'))}
            elif ref in secrets and secrets[ref].get('persist')!=bool(clean.get('persistSecret')):
                # Different retention choices own different references; neither profile can revoke the other's choice.
                value=secrets[ref]['value'];ref='secret_'+uuid.uuid4().hex;secrets[ref]={'value':value,'persist':bool(clean.get('persistSecret'))}
            clean['secretReference']=ref;clean.setdefault('displayName',p['id']);clean.setdefault('transport','relay')
            history=copy.deepcopy(old.get('compatibilityHistory',{}))
            if any(old.get(k) for k in ('lastTest','health','observations')):
                identity='|'.join(str(old.get(k,'')) for k in ('adapter','endpoint','model','transport'))
                history[identity]={k:copy.deepcopy(old[k]) for k in ('lastTest','health','observations') if k in old}
            if history:clean['compatibilityHistory']=history
            if (old.get('model'),old.get('endpoint'),old.get('adapter'))!=(clean.get('model'),clean.get('endpoint'),clean.get('adapter')) or (p.get('secret') and p['secret']!=self.secrets.get(old.get('secretReference'),{}).get('value')):
                for key in ('lastTest','health','observations'): clean.pop(key,None)
            if (clean.get('discovery') or {}).get('identity')!=clean['adapter']+'|'+clean['endpoint']:clean.pop('discovery',None)
            value=secrets.get(ref,{}).get('value','')
            if value and len(value)>12 and value in p['endpoint']:raise ValueError('Use header authentication. Do not put this key in the endpoint URL.')
            items[clean['id']]=clean
            used={profile.get('secretReference') for profile in items.values()};secrets={k:v for k,v in secrets.items() if k in used}
            self.persist(items,secrets);self.items=items;self.secrets=secrets
            return public_profile(clean,secrets)
    def remove(self,identity):
        with self.guard:
            if identity not in self.items: raise ValueError('Missing connection.')
            items=copy.deepcopy(self.items);items.pop(identity)
            used={p.get('secretReference') for p in items.values()};secrets={k:v for k,v in self.secrets.items() if k in used}
            self.persist(items,secrets);self.items=items;self.secrets=secrets
            return {'removed':identity}
    def connect(self,p,method,path=None,payload=None):
        secret=p.get('_secret',self.secrets.get(p.get('secretReference'),{}).get('value',''))
        if not secret and not (p.get('allowLocal') and urlsplit(p['endpoint']).hostname in {'localhost','127.0.0.1','::1'}):raise ProviderError('This profile needs its API key. Saved metadata is retained.','key_needed')
        u,addresses=endpoint(p['endpoint'],bool(p.get('allowLocal')),self.port); port=u.port or (443 if u.scheme=='https' else 80)
        info=addresses[0];sock=socket.socket(info[0],info[1],info[2]);sock.settimeout(90)
        conn=None
        try:
            sock.connect(info[4])
            if u.scheme=='https': sock=ssl.create_default_context().wrap_socket(sock,server_hostname=u.hostname)
            conn=http.client.HTTPConnection(u.hostname,port,timeout=90);conn.sock=sock
            if not secret and not p.get('allowLocal'): raise ProviderError('This profile needs its API key. Saved metadata is retained.', 'key_needed')
            headers={'Content-Type':'application/json','Accept':'text/event-stream' if method=='POST' else 'application/json'}
            if p['adapter']=='anthropic': headers.update({'x-api-key':secret,'anthropic-version':'2023-06-01'})
            elif secret: headers['Authorization']='Bearer '+secret
            conn.request(method,path or u.path or '/',body=json.dumps(payload).encode() if payload is not None else None,headers=headers)
            response=conn.getresponse()
            if response.status!=200:
                raw=response.read(65536)
                # Classify provider diagnostics without returning private content or credentials.
                try: d=json.loads(raw);detail=str(d.get('error',{}).get('message','')) if isinstance(d.get('error'),dict) else ''
                except (ValueError,TypeError): detail=''
                parameter=next((field for field in ('temperature','top_p','top_k','min_p','presence_penalty','frequency_penalty','repetition_penalty','seed','stop','thinking','reasoning','reasoning_effort','response_format','prefix') if re.search(r'\b'+field+r'\b',detail,re.I)),None)
                code={401:'invalid_credentials',403:'permission_denied',404:'unknown_model',408:'timeout',429:'rate_limited'}.get(response.status,'unsupported_endpoint' if 300<=response.status<400 else 'provider_error')
                if response.status==400: code='unsupported_parameter' if parameter else ('unknown_model' if 'model' in detail.lower() else 'invalid_request')
                if response.status==429 and re.search(r'quota|credit|billing|balance',detail,re.I): code='quota_restricted'
                messages={'invalid_credentials':'Provider authentication failed. Reenter the key.','permission_denied':'The provider denied permission for this connection.','unknown_model':'The selected model was not found or is not available to this account.','timeout':'The provider request timed out.','rate_limited':'The provider rate limited this request. Try later.','quota_restricted':'The provider reported a quota or billing restriction.','unsupported_parameter':'The provider refused the configured setting: '+str(parameter)+'.','unsupported_endpoint':'The provider endpoint did not accept this transport. Redirects are not followed.','invalid_request':'The provider rejected the request shape.'}
                raise ProviderError(messages.get(code,'Provider returned HTTP '+str(response.status)+'. Inspect the redacted diagnostic.'),code,response.status,parameter)
            return conn,response
        except ssl.SSLError:
            if conn: conn.close()
            else: sock.close()
            raise ProviderError('TLS verification failed. Certificates were not bypassed.', 'tls_failure')
        except (TimeoutError,socket.timeout):
            if conn: conn.close()
            else: sock.close()
            raise ProviderError('Connection timed out. Configuration is retained.', 'timeout')
        except ProviderError:
            if conn: conn.close()
            else: sock.close()
            raise
        except ValueError:
            if conn:conn.close()
            else:sock.close()
            raise ProviderError('Provider request headers or settings are invalid. Credentials were not included in this diagnostic.','invalid_request')
        except OSError:
            if conn: conn.close()
            else: sock.close()
            raise ProviderError('The provider connection could not be reached.', 'connection_unavailable')
    def models(self,identity):
        with self.guard:
            p=copy.deepcopy(self.items.get(identity))
            if p:p['_secret']=self.secrets.get(p.get('secretReference'),{}).get('value','')
        if not p: raise ValueError('Save this profile before discovering models.')
        u=urlsplit(p['endpoint']);path=re.sub(r'/(chat/completions|responses|messages)$','/models',u.path)
        if path==u.path: raise ValueError('Model discovery is unavailable for this endpoint. Enter the model manually.')
        conn,response=self.connect(p,'GET',path)
        try:
            raw=response.read(4*1024*1024+1)
            if len(raw)>4*1024*1024: raise ValueError('Model list exceeds its bounded size.')
            d=json.loads(raw)
            models=d.get('data',d.get('models',[]))
            if not isinstance(models,list): raise ValueError('Malformed model list.')
            return {'models':models,'endpoint':p['endpoint'],'fetchedAt':time.time()}
        finally: conn.close()
    def request(self,connection_id,adapter,payload):
        with self.guard:
            p=copy.deepcopy(self.items.get(connection_id))
            if p:p['_secret']=self.secrets.get(p.get('secretReference'),{}).get('value','')
        if not p or p['adapter']!=adapter: raise ValueError('Configure and save this connection first.')
        if payload.get('model')!=p['model'] or payload.get('stream') is not True: raise ValueError('Request does not match the configured profile.')
        caps=p.get('capabilities',{});common={'model','stream'}
        common|={k for k in ('temperature','top_p','top_k','min_p','presence_penalty','frequency_penalty','repetition_penalty','seed','stop') if caps.get(k)}
        if adapter=='anthropic' and caps.get('stop'): common.add('stop_sequences')
        if adapter=='responses': allowed=common|{'instructions','input','max_output_tokens','store'}|({'reasoning'} if caps.get('reasoning') else set());limit='max_output_tokens'
        elif adapter=='anthropic': allowed=common|{'system','messages','max_tokens'}|({'thinking','output_config'} if caps.get('reasoning') else set());limit='max_tokens'
        else:
            limit='max_completion_tokens' if caps.get('maxCompletionTokens') else 'max_tokens'
            allowed=common|{'messages',limit}|({'stream_options'} if caps.get('usage') else set())|({'store'} if caps.get('storage') else set())|({'reasoning','reasoning_effort','thinking','enable_thinking','model_options'} if caps.get('reasoning') else set())|({'response_format'} if caps.get('structured') else set())
        if caps.get('web') and adapter in {'responses','anthropic'}: allowed.add('tools')
        if caps.get('web') and adapter=='openrouter':allowed.add('plugins')
        if caps.get('reasoning') and p.get('reasoningStyle')=='gemini' and adapter=='chat':allowed.add('extra_body')
        if set(payload)-allowed: raise ValueError('Unsupported request parameter.')
        if not isinstance(payload.get(limit),int) or not 1<=payload[limit]<=int(p.get('outputLimit',2000)): raise ValueError('Invalid output allowance.')
        if payload.get('store') not in (None,False): raise ValueError('Provider conversation storage must be disabled.')
        for message in payload.get('messages',payload.get('input',[])):
            if message.get('role') not in {'system','user','assistant'}: raise ValueError('Invalid message role.')
            if set(message)-{'role','content','prefix','reasoning_content'}: raise ValueError('Unsupported message fields.')
            if message.get('prefix') and not caps.get('prefix'): raise ValueError('Prefix is not configured for this endpoint.')
            if message.get('reasoning_content') and not caps.get('thinkingSeed'): raise ValueError('Thinking seed is not configured for this endpoint.')
        if 'extra_body' in payload:
            extra=payload['extra_body']
            if set(extra)!={'google'} or set(extra['google'])!={'thinking_config'} or set(extra['google']['thinking_config'])!={'thinking_budget'} or not isinstance(extra['google']['thinking_config']['thinking_budget'],int):raise ValueError('Only the configured Gemini thinking budget extension is allowed.')
        if 'model_options' in payload:
            options=payload['model_options']
            if set(options)!={'reasoning'} or set(options['reasoning'])-{'enabled','effort'}:raise ValueError('Only configured Hermes reasoning options are allowed.')
        if 'plugins' in payload:
            if not isinstance(payload['plugins'],list) or any(plugin.get('id')!='web' or plugin.get('engine')!='native' or set(plugin)-{'id','engine','max_results'} for plugin in payload['plugins']):raise ValueError('Only the configured native web lookup plugin is allowed.')
        if 'tools' in payload:
            for tool in payload['tools']:
                if tool.get('type') not in {'web_search','web_search_20250305'} or set(tool)-{'type','name','max_uses'}: raise ValueError('Only the configured native web lookup tool is allowed.')
        conn,response=self.connect(p,'POST',payload=payload)
        if 'text/event-stream' not in response.getheader('Content-Type',''):
            conn.close();raise ProviderError('Provider did not return a compatible event stream.', 'malformed_response')
        return conn,response
