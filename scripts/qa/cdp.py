"""Minimal, dependency-free Chrome DevTools Protocol client used by the QA scripts.

Only the Python standard library is required. Chrome/Chromium is located via the
CHROME environment variable, then common install paths.

    from cdp import Chrome
    with Chrome(width=1280, height=900) as c:
        c.goto('file:///path/to/index.html')
        print(c.eval('document.title'))
        c.screenshot('out.png')
"""
import base64
import json
import os
import shutil
import socket
import struct
import subprocess
import tempfile
import time
import urllib.request

CANDIDATES = [
    os.environ.get('CHROME', ''),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    shutil.which('google-chrome') or '',
    shutil.which('google-chrome-stable') or '',
    shutil.which('chromium') or '',
    shutil.which('chromium-browser') or '',
]


def find_chrome():
    for path in CANDIDATES:
        if path and os.path.exists(path):
            return path
    raise FileNotFoundError('Chrome not found; set the CHROME environment variable')


class _WebSocket:
    """Just enough RFC 6455 for CDP: masked text frames out, (fragmented) frames in."""

    def __init__(self, url):
        hostport, path = url[len('ws://'):].split('/', 1)
        host, port = hostport.split(':')
        self.sock = socket.create_connection((host, int(port)))
        key = base64.b64encode(os.urandom(16)).decode()
        request = (f'GET /{path} HTTP/1.1\r\nHost: {hostport}\r\nUpgrade: websocket\r\n'
                   f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n')
        self.sock.sendall(request.encode())
        buf = b''
        while b'\r\n\r\n' not in buf:
            buf += self.sock.recv(4096)
        head, self.rest = buf.split(b'\r\n\r\n', 1)
        if b' 101 ' not in head.split(b'\r\n')[0]:
            raise ConnectionError(head.decode(errors='replace'))

    def _read(self, n):
        out = self.rest[:n]
        self.rest = self.rest[n:]
        while len(out) < n:
            chunk = self.sock.recv(max(65536, n - len(out)))
            if not chunk:
                raise ConnectionError('socket closed')
            out += chunk
        if len(out) > n:
            self.rest = out[n:] + self.rest
            out = out[:n]
        return out

    def send(self, text):
        data = text.encode()
        header = bytearray([0x81])
        n = len(data)
        if n < 126:
            header.append(0x80 | n)
        elif n < 65536:
            header.append(0x80 | 126)
            header += struct.pack('>H', n)
        else:
            header.append(0x80 | 127)
            header += struct.pack('>Q', n)
        mask = os.urandom(4)
        header += mask
        self.sock.sendall(bytes(header) + bytes(b ^ mask[i % 4] for i, b in enumerate(data)))

    def recv(self):
        message = b''
        while True:
            b1, b2 = self._read(2)
            fin, opcode, n = b1 & 0x80, b1 & 0x0F, b2 & 0x7F
            if n == 126:
                n = struct.unpack('>H', self._read(2))[0]
            elif n == 127:
                n = struct.unpack('>Q', self._read(8))[0]
            payload = self._read(n)
            if opcode == 8:
                raise ConnectionError('websocket closed')
            if opcode in (9, 10):
                continue
            message += payload
            if fin:
                return message.decode()


class Chrome:
    """Headless Chrome with one page target. Use as a context manager."""

    def __init__(self, width=1280, height=900, dpr=1, extra_args=()):
        self.profile = tempfile.mkdtemp(prefix='bb-cdp-')
        args = [find_chrome(), '--headless=new', '--remote-debugging-port=0', f'--user-data-dir={self.profile}',
                '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
                f'--window-size={width},{height}', '--allow-file-access-from-files',
                '--autoplay-policy=no-user-gesture-required', *extra_args, 'about:blank']
        if os.environ.get('CI'):
            args.insert(1, '--no-sandbox')
        self.proc = subprocess.Popen(args, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        port_file = os.path.join(self.profile, 'DevToolsActivePort')
        for _ in range(400):
            if os.path.exists(port_file) and open(port_file).read().strip():
                break
            time.sleep(0.05)
        port = open(port_file).read().split()[0]
        targets = json.load(urllib.request.urlopen(f'http://127.0.0.1:{port}/json/list'))
        page = [t for t in targets if t['type'] == 'page'][0]
        self.ws = _WebSocket(page['webSocketDebuggerUrl'])
        self.next_id = 0
        self.events = []
        for domain in ('Page', 'Runtime', 'Log'):
            self.call(f'{domain}.enable')
        self.viewport(width, height, dpr=dpr)

    def call(self, method, **params):
        self.next_id += 1
        mid = self.next_id
        self.ws.send(json.dumps({'id': mid, 'method': method, 'params': params}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get('id') == mid:
                if 'error' in msg:
                    raise RuntimeError(f'{method}: {msg["error"]}')
                return msg.get('result', {})
            self.events.append(msg)

    def pump(self, seconds):
        """Waits in real time while collecting protocol events."""
        end = time.time() + seconds
        self.ws.sock.settimeout(0.05)
        try:
            while time.time() < end:
                try:
                    self.events.append(json.loads(self.ws.recv()))
                except (socket.timeout, BlockingIOError):
                    pass
        finally:
            self.ws.sock.settimeout(None)

    def goto(self, url, settle=0.6):
        self.events.clear()
        self.call('Page.navigate', url=url)
        start = time.time()
        while time.time() - start < 20:
            if any(e.get('method') == 'Page.loadEventFired' for e in self.events):
                break
            self.pump(0.1)
        self.pump(settle)

    def eval(self, expression, timeout=120):
        result = self.call('Runtime.evaluate', expression=expression, awaitPromise=True,
                           returnByValue=True, userGesture=True, timeout=timeout * 1000)
        if 'exceptionDetails' in result:
            raise RuntimeError(json.dumps(result['exceptionDetails'])[:1500])
        return result['result'].get('value')

    def wait_for(self, expression, timeout=30, interval=0.1):
        end = time.time() + timeout
        while time.time() < end:
            if self.eval(expression):
                return True
            self.pump(interval)
        return False

    def click_at(self, x, y):
        for kind in ('mousePressed', 'mouseReleased'):
            self.call('Input.dispatchMouseEvent', type=kind, x=x, y=y, button='left', clickCount=1)

    def key(self, key, code=None, text=None):
        base = {'key': key, 'code': code or key}
        self.call('Input.dispatchKeyEvent', type='keyDown', text=text or (key if len(key) == 1 else ''), **base)
        self.call('Input.dispatchKeyEvent', type='keyUp', **base)

    def viewport(self, width, height, mobile=False, dpr=1):
        self.call('Emulation.setDeviceMetricsOverride', width=width, height=height,
                  deviceScaleFactor=dpr, mobile=mobile)

    def screenshot(self, path, full=False):
        params = {'format': 'png'}
        if full:
            params['captureBeyondViewport'] = True
        data = self.call('Page.captureScreenshot', **params)['data']
        with open(path, 'wb') as f:
            f.write(base64.b64decode(data))
        return path

    def errors(self):
        out = []
        for e in self.events:
            method = e.get('method')
            if method == 'Runtime.exceptionThrown':
                d = e['params']['exceptionDetails']
                out.append('exception: ' + (d.get('exception', {}).get('description') or d.get('text', '')))
            elif method == 'Runtime.consoleAPICalled' and e['params']['type'] in ('error', 'assert'):
                out.append('console: ' + ' '.join(str(a.get('value', a.get('description', ''))) for a in e['params']['args']))
            elif method == 'Log.entryAdded' and e['params']['entry']['level'] == 'error':
                out.append('log: ' + e['params']['entry']['text'])
        return out

    def close(self):
        try:
            self.proc.terminate()
            self.proc.wait(5)
        except Exception:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()
