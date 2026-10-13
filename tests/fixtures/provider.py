"""Deterministic provider boundary for synthetic tests, never a production fallback."""
import json
import re
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def end_headers(self):
        if not getattr(self,'denyCORS',False):self.send_header('Access-Control-Allow-Origin',self.headers.get('Origin','*'))
        self.send_header('Access-Control-Allow-Headers','Content-Type, Authorization, x-api-key, anthropic-version, anthropic-dangerous-direct-browser-access')
        self.send_header('Access-Control-Allow-Methods','GET, POST, OPTIONS')
        super().end_headers()
    def do_OPTIONS(self):self.send_response(204);self.end_headers()
    def do_GET(self):
        models=[{'id':'synthetic-fixture','context_length':500000,'top_provider':{'max_completion_tokens':8192},'supported_parameters':['temperature','top_p','top_k','min_p','seed','stop','reasoning']},{'id':'second-model','context_length':200000},{'id':'helper-model'}]
        data={'data':models} if self.path.endswith('/models') else {'requests':requests}
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps(data).encode())
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        requests.append(body)
        failure=body.get('model','');self.denyCORS=failure=='cors-error'
        code={'auth-error':401,'permission-error':403,'missing-model':404,'parameter-error':400,'rate-error':429,'quota-error':429}.get(failure)
        if code:
            self.send_response(code);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'error':{'message':'Unsupported parameter temperature' if failure=='parameter-error' else 'billing quota exhausted' if failure=='quota-error' else 'PRIVATE provider diagnostic'}}).encode());return
        if failure=='timeout-test':time.sleep(21)
        messages=body.get('messages',[]);user=messages[-1]['content'] if messages else body['input'][-1]['content'][0]['text'];system=body.get('system',body.get('instructions',messages[0]['content'] if messages else ''))
        kind=re.search(r'"operation":"([^"]+)"',user);kind=kind.group(1) if kind else 'write'
        if kind=='analysis':
            segment=re.search(r'\[Source segment for structured reading[^\]]*\]\n(.*?)(?:\n\n\[|$)',user,re.S)
            source_text=segment.group(1) if segment else ''
            span=re.search(r'Segment starts at (\d+), ends at (\d+)',user);coverage=int(span.group(2)) if span else len(source_text)
            people={}
            for raw in re.findall(r'\[People and places[^\]]*\]\n([^\n]+)',user):
                try:
                    entry=json.loads(raw);people[entry['name']]=entry['id']
                except (KeyError,ValueError):pass
            quotes={'A':'A rested tired hands','B':'B smiled at the familiar street','C':'C listened without a word','D':'D arrived with a newspaper.'}
            entities=[{'key':name,'name':name,'kind':'person','quote':quote,**({'existingId':people[name]} if name in people else {})} for name,quote in quotes.items() if quote in source_text]
            definitions=[('condition','A was tired.','A','A rested tired hands around a warm cup.'),('plan','B promised to bring an umbrella if the rain continued.','B','B promised to bring an umbrella if the rain continued.'),('knowledge','C learned that the letter was missing.','C','A told C that the letter was missing.'),('belief','D suspected the letter contained coins.','D','D suspected the letter contained coins.'),('relationship','A trusted B to help.','A','A said he trusted B to help.'),('acceptedEvent','B finished ordering the drinks.','B','B finished ordering the drinks.'),('condition','C waited beside the door.','C','C set the umbrella beside the door and waited for B to answer. A told C that chocolate was available.')]
            updates=[{'recordKind':kind,'holderRef':people.get(person,person) if kind in ('knowledge','belief','plan') else '', 'subjectRef':people.get(person,person),'proposition':prop,'quote':quote,'support':'explicit','certainty':'suspicion' if kind=='belief' else 'known'} for kind,prop,person,quote in definitions if quote in source_text]
            text=json.dumps({'suggestions':['Let B ask about the rain','Stay with C’s quiet moment','Walk to the ice cream shop'],'entities':entities,'updates':updates,'summary':'The friends met on a rainy afternoon.','coverageEnd':coverage})
        elif kind=='eventProposal':
            people={}
            for raw in re.findall(r'\[People and places[^\]]*\]\n([^\n]+)',user):
                try:
                    entry=json.loads(raw);people[entry['name']]=entry['id']
                except (KeyError,ValueError):pass
            text=json.dumps({'summary':'B asked for chocolate ice cream. A asked a question and told C that chocolate was available. C waited.','events':[{'recordKind':'acceptedEvent','proposition':'B asked for chocolate ice cream.','quote':'B asked for chocolate ice cream.'}],'stateChanges':[{'recordKind':'knowledge','proposition':'C learned that chocolate was available.','quote':'A told C that chocolate was available.','holderId':people.get('C'),'certainty':'known'}] if people.get('C') else []})
        elif kind=='director':text='Possibility: let the café conversation reach one small shared plan. Keep the scene quiet. This guidance establishes no event.'
        elif kind=='editor':text='Observation: the scene uses quiet physical details. Consider varying the next line of dialogue. This is optional craft advice.'
        elif kind=='recall':
            ids=re.findall(r'"id":"(revision_[^"]+)"',user)
            text=json.dumps({'sourceIds':list(dict.fromkeys(ids))[:2]})
        elif kind=='rp':text='A smiled at B. "Chocolate, then?" C set the umbrella beside the door and waited for B to answer. A told C that chocolate was available.'
        elif kind=='adapt':text='B asked for chocolate ice cream. A smiled. "Chocolate, then?" C set the umbrella beside the door and waited. A told C that chocolate was available.'
        elif kind=='revise':text='雨 lingered against the glass.\n"A quieter afternoon," she said. ☕'
        elif kind=='discuss':text='Established: C is quiet in this passage. Inference: C may be distracted. Possibility: let a small question reveal what holds C’s attention.'
        elif 'ice cream' in user.lower().split('[author direction]')[-1]:text='B suggested ice cream. A folded the newspaper, and C reached for the umbrella.'
        else:text='Rain tapped against the café window. A rested tired hands around a warm cup. B smiled at the familiar street, while C listened without a word. D arrived with a newspaper. B promised to bring an umbrella if the rain continued. A told C that the letter was missing. D suspected the letter contained coins. A said he trusted B to help. B finished ordering the drinks.'
        if body.get('response_format'):
            prop=body['response_format']['json_schema']['schema']['properties']['prose']
            opening=re.sub(r'\\(.)',r'\1',prop['pattern'][1:].split('(?:',1)[0])
            text=json.dumps({'prose':opening+' The afternoon grew quiet beside the rain.'})
        if 'SLOW_TEST' in user:time.sleep(.7)
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        try:
            if failure=='malformed-test':self.wfile.write(b'data: broken json\n\n');return
            for i in range(0,len(text),19):
                if 'SLOW_TEST' in user:time.sleep(.06)
                if 'max_output_tokens' in body:d={'type':'response.output_text.delta','delta':text[i:i+19]}
                elif 'system' in body:d={'type':'content_block_delta','delta':{'type':'text_delta','text':text[i:i+19]}}
                else:d={'choices':[{'delta':{'content':text[i:i+19]}}]}
                self.wfile.write(('data: '+json.dumps(d,ensure_ascii=False)+'\n\n').encode());self.wfile.flush()
            if failure=='disconnect-test':return
            if 'max_output_tokens' in body:end='data: '+json.dumps({'type':'response.completed','response':{'usage':{'input_tokens':120,'output_tokens':50}}})+'\n\n'
            elif 'system' in body:end='data: '+json.dumps({'type':'message_delta','delta':{'stop_reason':'end_turn'},'usage':{'input_tokens':120,'output_tokens':50}})+'\n\ndata: {"type":"message_stop"}\n\n'
            else:end='data: '+json.dumps({'choices':[],'usage':{'prompt_tokens':120,'completion_tokens':50}})+'\n\ndata: [DONE]\n\n'
            self.wfile.write(end.encode());self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass
requests=[]
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
print(server.server_port,flush=True)
server.serve_forever()
