import copy
import json
import os
import socket
import ssl
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch, MagicMock
from server.relay import Profiles,endpoint,ProviderError

def profile(identity='writer',**changes):
    return {'id':identity,'displayName':identity,'adapter':'chat','endpoint':'https://offline.example/v1/chat/completions','model':'one','contextLimit':32000,'outputLimit':2000,'capabilities':{},'parameters':{},**changes}
class ConnectionTests(unittest.TestCase):
    def setUp(self):self.temp=tempfile.TemporaryDirectory();self.directory=Path(self.temp.name);self.p=Profiles(self.directory,8081)
    def tearDown(self):self.temp.cleanup()
    def test_offline_save_has_no_dns_and_failed_atomic_write_keeps_previous(self):
        with patch('server.relay.socket.getaddrinfo',side_effect=AssertionError('No DNS during Save')):
            self.p.save(profile('connection_UUID-123',secret='SYNTHETIC',persistSecret=True))
        original=self.p.path.read_bytes();memory=copy.deepcopy(self.p.items)
        with patch('server.relay.os.replace',side_effect=OSError('simulated disk failure')):
            with self.assertRaises(OSError):self.p.save(profile('second'))
        self.assertEqual(self.p.path.read_bytes(),original);self.assertEqual(self.p.items,memory)
    def test_independent_profiles_shared_reference_restart_and_deletion(self):
        a=self.p.save(profile('a',secret='SYNTHETIC_A',persistSecret=True))
        b=self.p.save(profile('b',model='second',secretFromId='a',persistSecret=True))
        c=self.p.save(profile('c',secret='SYNTHETIC_C',persistSecret=False))
        self.assertEqual(a['secretReference'],b['secretReference']);self.assertNotIn('secret',a)
        restarted=Profiles(self.directory,8081);public={p['id']:p for p in restarted.public()}
        self.assertTrue(public['a']['hasSecret']);self.assertTrue(public['b']['hasSecret']);self.assertFalse(public['c']['hasSecret'])
        restarted.save(profile('b',model='third',secret='SYNTHETIC_B',persistSecret=True));self.assertEqual(restarted.items['a']['model'],'one')
        self.assertNotEqual(restarted.items['a']['secretReference'],restarted.items['b']['secretReference'])
        restarted.remove('a');self.assertEqual(set(restarted.items),{'b','c'});self.assertTrue(next(p for p in restarted.public() if p['id']=='b')['hasSecret'])
        self.assertEqual(os.stat(restarted.path).st_mode&0o777,0o600)
    def test_legacy_migration_keeps_identity_settings_and_explicit_key_policy(self):
        original={'primary':profile('primary',parameters={'temperature':.725},secret='SYNTHETIC_LEGACY',persistSecret=True),'helper':profile('helper',model='helper',persistSecret=False)}
        self.p.path.write_text(json.dumps(original));os.chmod(self.p.path,0o600)
        upgraded=Profiles(self.directory,8081);self.assertEqual(upgraded.items['primary']['parameters'],{'temperature':.725});self.assertEqual(upgraded.items['helper']['model'],'helper')
        self.assertEqual(json.loads((self.directory/'connections.legacy.json').read_text()),original)
        public={p['id']:p for p in upgraded.public()};self.assertTrue(public['primary']['hasSecret']);self.assertFalse(public['helper']['hasSecret']);self.assertEqual(json.loads(upgraded.path.read_text())['version'],2)
    def test_host_change_does_not_forward_existing_credential_and_destinations_are_checked_on_use(self):
        self.p.save(profile('a',secret='SYNTHETIC',persistSecret=True));a=self.p.save(profile('a',endpoint='https://different.example/v1/chat/completions'))
        self.assertFalse(a['hasSecret'])
        self.p.save(profile('secure_local',endpoint='https://localhost/v1/chat/completions',allowLocal=True,secret='SYNTHETIC_LOCAL',persistSecret=True))
        changed=self.p.save(profile('secure_local',endpoint='http://localhost/v1/chat/completions',allowLocal=True))
        self.assertFalse(changed['hasSecret'])
        with self.assertRaises(ValueError):self.p.save(profile('cross_scheme',endpoint='https://localhost/v1/chat/completions',allowLocal=True,secretFromId='secure_local'))
        with self.assertRaises(ValueError):self.p.save(profile('b',endpoint='http://192.168.0.1/v1/chat/completions',allowLocal=True))
        with patch('server.relay.socket.getaddrinfo',side_effect=OSError('offline')):
            with self.assertRaises(OSError):endpoint('https://offline.example/v1/chat/completions')
        with patch('server.relay.socket.getaddrinfo',return_value=[(2,1,6,'',('10.0.0.1',443))]):
            with self.assertRaises(ValueError):endpoint('https://rebinding.example/v1/chat/completions')
    def test_corrupt_recovery_is_bounded_and_future_format_remains_untouched(self):
        self.p.save(profile('a'));self.p.save(profile('b'));self.p.path.write_text('broken')
        recovered=Profiles(self.directory,8081);self.assertIsNotNone(recovered.warning);self.assertIn('a',recovered.items);Profiles(self.directory,8081);self.assertEqual(len(list(self.directory.glob('connections.corrupt.*.json'))),1)
        self.p.path.write_text('{"version":99}');before=self.p.path.read_bytes()
        with self.assertRaises(ValueError):Profiles(self.directory,8081)
        self.assertEqual(self.p.path.read_bytes(),before)
    def test_stale_profile_edits_cannot_overwrite_newer_settings(self):
        a=self.p.save(profile('a'));a=self.p.save(dict(a,observations={'code':'provider_refusal','identity':'chat|https://offline.example/v1/chat/completions|one'}));b=self.p.save(dict(a,model='newer'))
        self.assertEqual(next(iter(b['compatibilityHistory'].values()))['observations']['code'],'provider_refusal');self.assertNotIn('observations',b)
        with self.assertRaises(ValueError):self.p.save(dict(a,model='stale'))
        self.assertEqual(self.p.items['a']['model'],'newer');self.assertGreater(b['profileVersion'],a['profileVersion'])
        with self.assertRaises(ProviderError) as error:self.p.request('a','chat',{'model':'newer','stream':True},a['profileVersion'],a['endpoint'])
        self.assertEqual(error.exception.code,'connection_changed')
    def test_retention_changes_do_not_revoke_an_independent_profile_and_invalid_key_is_redacted(self):
        a=self.p.save(profile('a',secret='SYNTHETIC_RETENTION_KEY',persistSecret=True));b=self.p.save(profile('b',secretFromId='a',persistSecret=False))
        self.assertNotEqual(a['secretReference'],b['secretReference'])
        restarted=Profiles(self.directory,8081);by_id={p['id']:p for p in restarted.public()}
        self.assertTrue(by_id['a']['hasSecret']);self.assertFalse(by_id['b']['hasSecret'])
        with self.assertRaises(ValueError) as error:self.p.save(profile('newline',secret='SYNTHETIC_PRIVATE\nline'))
        self.assertNotIn('SYNTHETIC_PRIVATE',str(error.exception))

    def test_dns_and_tls_failures_keep_configuration_and_never_bypass_certificates(self):
        self.p.save(profile('a',secret='SYNTHETIC_TLS_KEY'))
        with patch('server.relay.socket.getaddrinfo',side_effect=socket.gaierror('offline')):
            with self.assertRaises(ProviderError) as error:self.p.models('a')
        self.assertEqual(error.exception.code,'dns_failure')
        addresses=[(2,1,6,'',('93.184.216.34',443))]
        context=MagicMock();context.wrap_socket.side_effect=ssl.SSLError('SYNTHETIC_TLS_KEY')
        with patch('server.relay.socket.getaddrinfo',return_value=addresses),patch('server.relay.socket.socket',return_value=MagicMock()),patch('server.relay.ssl.create_default_context',return_value=context):
            with self.assertRaises(ProviderError) as error:self.p.models('a')
        self.assertEqual(error.exception.code,'tls_failure');self.assertNotIn('SYNTHETIC_TLS_KEY',str(error.exception));self.assertIn('a',self.p.items)
    def test_prices_and_retention_preferences_have_explicit_boundary_types(self):
        for fields in ({'inputPrice':-1},{'outputPrice':float('inf')},{'persistSecret':'false'},{'capabilities':{'reasoning':'yes'}},{'reasoningReserve':-1}):
            with self.assertRaises(ValueError):self.p.save(profile('invalid',**fields))
        self.assertNotIn('invalid',self.p.items)
