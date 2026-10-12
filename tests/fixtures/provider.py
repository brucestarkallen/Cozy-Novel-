"""Deterministic provider boundary for synthetic tests, never a production fallback."""
import json
import re
import time
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
class Handler(BaseHTTPRequestHandler):
    def log_message(self,*args):pass
    def do_POST(self):
        body=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        messages=body.get('messages',[]);user=messages[-1]['content'] if messages else body['input'][-1]['content'][0]['text'];system=body.get('system',body.get('instructions',messages[0]['content'] if messages else ''))
        kind=re.search(r'"operation":"([^"]+)"',user);kind=kind.group(1) if kind else 'write'
        if kind=='analysis':
            source=re.findall(r'Unaccepted candidate, not canon \| source ([^\]]+)',user)
            if not source:source=re.findall(r'Current manuscript \| source ([^\]]+)',user)
            text=json.dumps({'suggestions':['Let B ask about the rain','Stay with C’s quiet moment','Walk to the ice cream shop'],'memories':[{'proposition':'The friends shared a rainy afternoon.','sourceId':source[-1] if source else '', 'quote':'Rain tapped against the café window.','recordKind':'memory'}]})
        elif kind=='rp':text='A smiled at B. "Chocolate, then?" C set the umbrella beside the door and waited for B to answer.'
        elif kind=='adapt':text='B asked for chocolate ice cream. A smiled. "Chocolate, then?" C set the umbrella beside the door and waited.'
        elif kind=='revise':text='雨 lingered against the glass.\n"A quieter afternoon," she said. ☕'
        elif kind=='discuss':text='Established: C is quiet in this passage. Inference: C may be distracted. Possibility: let a small question reveal what holds C’s attention.'
        elif 'ice cream' in user.lower().split('[author direction]')[-1]:text='B suggested ice cream. A folded the newspaper, and C reached for the umbrella.'
        else:text='Rain tapped against the café window. A rested tired hands around a warm cup. B smiled at the familiar street, while C listened without a word.'
        if 'SLOW_TEST' in user:time.sleep(.7)
        self.send_response(200);self.send_header('Content-Type','text/event-stream');self.end_headers()
        try:
            for i in range(0,len(text),19):
                if 'SLOW_TEST' in user:time.sleep(.06)
                if 'max_output_tokens' in body:d={'type':'response.output_text.delta','delta':text[i:i+19]}
                elif 'system' in body:d={'type':'content_block_delta','delta':{'type':'text_delta','text':text[i:i+19]}}
                else:d={'choices':[{'delta':{'content':text[i:i+19]}}]}
                self.wfile.write(('data: '+json.dumps(d,ensure_ascii=False)+'\n\n').encode());self.wfile.flush()
            if 'max_output_tokens' in body:end='data: '+json.dumps({'type':'response.completed','response':{'usage':{'input_tokens':120,'output_tokens':50}}})+'\n\n'
            elif 'system' in body:end='data: '+json.dumps({'type':'message_delta','delta':{'stop_reason':'end_turn'},'usage':{'input_tokens':120,'output_tokens':50}})+'\n\ndata: {"type":"message_stop"}\n\n'
            else:end='data: '+json.dumps({'choices':[],'usage':{'prompt_tokens':120,'completion_tokens':50}})+'\n\ndata: [DONE]\n\n'
            self.wfile.write(end.encode());self.wfile.flush()
        except (BrokenPipeError,ConnectionResetError):pass
server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
print(server.server_port,flush=True)
server.serve_forever()
