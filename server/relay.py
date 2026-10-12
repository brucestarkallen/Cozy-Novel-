"""Explicit profiles. No redirects, arbitrary proxy payloads, or provider error bodies."""
import http.client
import ipaddress
import json
import os
import socket
import ssl
from urllib.parse import urlsplit

ADAPTERS={'responses','chat','anthropic','openrouter'}
def endpoint(value,allow_local=False,own_port=8081):
    u=urlsplit(value)
    if u.scheme not in {'http','https'} or not u.hostname or u.username or u.password or u.query or u.fragment:raise ValueError('Invalid provider endpoint.')
    port=u.port or (443 if u.scheme=='https' else 80)
    addresses=socket.getaddrinfo(u.hostname,port,type=socket.SOCK_STREAM)
    for item in addresses:
        ip=ipaddress.ip_address(item[4][0])
        if not ip.is_global and not (allow_local and ip.is_loopback and port!=own_port):raise ValueError('This relay destination is not allowed. Explicit local model configuration permits loopback only.')
    if u.scheme!='https' and not all(ipaddress.ip_address(a[4][0]).is_loopback for a in addresses):raise ValueError('Remote providers require verified HTTPS.')
    if allow_local and not u.path.startswith(('/v1/','/api/chat','/api/generate')):raise ValueError('Use an explicit local model API path.')
    return u,addresses

class Profiles:
    def __init__(self,directory,port):
        self.path=directory/'connections.json';self.port=port;self.items={}
        if self.path.exists():
            if os.stat(self.path).st_mode & 0o077:raise ValueError('Connection file permissions must be 600.')
            self.items=json.loads(self.path.read_text())
    def public(self):return [{k:v for k,v in p.items() if k!='secret'}|{'hasSecret':bool(p.get('secret'))} for p in self.items.values()]
    def save(self,p):
        if p.get('id') not in {'primary','helper'} or p.get('adapter') not in ADAPTERS or not isinstance(p.get('model'),str) or not p['model'].strip():raise ValueError('Invalid connection profile.')
        endpoint(p.get('endpoint',''),bool(p.get('allowLocal')),self.port)
        allowed={'id','adapter','endpoint','model','contextLimit','outputLimit','reasoningReserve','capabilityConfirmed','capabilities','parameters','inputPrice','outputPrice','secret','persistSecret','allowLocal'}
        clean={k:v for k,v in p.items() if k in allowed}
        if not clean.get('secret'):clean['secret']=self.items.get(clean['id'],{}).get('secret','')
        self.items[clean['id']]=clean
        persisted={k:({a:b for a,b in v.items() if a!='secret'}|({'secret':v['secret']} if v.get('persistSecret') else {})) for k,v in self.items.items()}
        temp=self.path.with_suffix('.tmp');fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
        with os.fdopen(fd,'w') as f:json.dump(persisted,f);f.flush();os.fsync(f.fileno())
        os.replace(temp,self.path);os.chmod(self.path,0o600)
        return next(x for x in self.public() if x['id']==p['id'])
    def request(self,connection_id,adapter,payload):
        p=self.items.get(connection_id)
        if not p or p['adapter']!=adapter:raise ValueError('Configure and save this connection first.')
        if payload.get('model')!=p['model'] or payload.get('stream') is not True:raise ValueError('Request does not match the configured profile.')
        common={'model','stream'}
        caps=p.get('capabilities',{})
        if caps.get('temperature'):common.add('temperature')
        if caps.get('top_p'):common.add('top_p')
        if adapter=='responses':allowed=common|{'instructions','input','max_output_tokens','store'}|({'reasoning'} if caps.get('reasoning') else set());limit='max_output_tokens'
        elif adapter=='anthropic':allowed=common|{'system','messages','max_tokens'};limit='max_tokens'
        else:
            limit='max_completion_tokens' if caps.get('maxCompletionTokens') else 'max_tokens'
            allowed=common|{'messages',limit}|({'stream_options'} if caps.get('usage') else set())|({'store'} if caps.get('storage') else set())
        if set(payload)-allowed:raise ValueError('Unsupported request parameter.')
        if not isinstance(payload.get(limit),int) or not 1<=payload[limit]<=int(p.get('outputLimit',2000)):raise ValueError('Invalid output allowance.')
        if payload.get('store') not in (None,False):raise ValueError('Provider conversation storage must be disabled.')
        for message in payload.get('messages',payload.get('input',[])):
            if message.get('role') not in {'system','user','assistant'}:raise ValueError('Invalid message role.')
        u,addresses=endpoint(p['endpoint'],bool(p.get('allowLocal')),self.port)
        port=u.port or (443 if u.scheme=='https' else 80)
        # Pin the validated address for this connection, retaining hostname TLS verification.
        info=addresses[0];sock=socket.socket(info[0],info[1],info[2]);sock.settimeout(90);sock.connect(info[4])
        if u.scheme=='https':sock=ssl.create_default_context().wrap_socket(sock,server_hostname=u.hostname)
        conn=http.client.HTTPConnection(u.hostname,port,timeout=90);conn.sock=sock
        headers={'Content-Type':'application/json','Accept':'text/event-stream'}
        if adapter=='anthropic':headers.update({'x-api-key':p.get('secret',''),'anthropic-version':'2023-06-01'})
        elif p.get('secret'):headers['Authorization']='Bearer '+p['secret']
        conn.request('POST',u.path or '/',body=json.dumps(payload).encode(),headers=headers)
        response=conn.getresponse()
        if response.status!=200:
            conn.close();raise ValueError('Provider returned HTTP '+str(response.status)+'. Check credentials, model and quota. Redirects are not followed.')
        if 'text/event-stream' not in response.getheader('Content-Type',''):
            conn.close();raise ValueError('Provider did not return an event stream.')
        return conn,response
