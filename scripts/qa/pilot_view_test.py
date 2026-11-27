"""Browser regression for the atomic 3D handoff and artwork-only facing.

Run with CHROME=/path/to/chromium python3 scripts/qa/pilot_view_test.py.
The standard-library fixture serves the real entry point and holds specific
requests, so the slow first-load checks don't depend on network speed.
"""
from contextlib import contextmanager
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Event, Thread
from urllib.parse import urlsplit

from cdp import Chrome

ROOT = Path(__file__).resolve().parents[2]
STILL = "/assets/pilot/stage.webp"
PORTRAITS = "/assets/pilot/packs/portraits.json"
VIDEO = {"/assets/pilot/intro.webm", "/assets/pilot/intro.mp4"}


@contextmanager
def server():
    gates = {}
    missing = set()

    class Handler(SimpleHTTPRequestHandler):
        def do_GET(self):
            path = urlsplit(self.path).path
            if path in missing:
                self.send_error(404)
                return
            if path in gates and not gates[path].wait(12):
                self.send_error(504)
                return
            super().do_GET()

        def end_headers(self):
            self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def log_message(self, *_args):
            pass

        def handle_one_request(self):
            try:
                super().handle_one_request()
            except (BrokenPipeError, ConnectionResetError):
                pass  # Expected when an intro is cancelled mid-download.

    with ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=ROOT)) as httpd:
        thread = Thread(target=httpd.serve_forever, daemon=True)
        thread.start()
        try:
            yield f"http://127.0.0.1:{httpd.server_port}/index.html", gates, missing
        finally:
            for gate in gates.values():
                gate.set()
            httpd.shutdown()
            thread.join()


HELPERS = r"""
  window.q = s => document.querySelector(s);
  window.ds = document.documentElement.dataset;
  window.visible = node => !!node && getComputedStyle(node).display !== 'none' &&
    getComputedStyle(node).visibility === 'visible' && !!node.getClientRects().length;
  // Compose the transforms through all ancestors. Looking only at the
  // innermost node would miss a second flip on a layout/animation wrapper.
  window.artDirectionSign = node => {
    let product = 1;
    for (; node instanceof Element; node = node.parentElement) {
      const m = new DOMMatrix(getComputedStyle(node).transform);
      product *= m.a * m.d - m.b * m.c;
    }
    return Math.sign(product);
  };
  window.classicTerrain = () => ['.moon','.city','.floor','.versus']
    .filter(s => visible(q('#stage ' + s)));
  window.readyArt = () => ds.art === '3d' && q('#stage').dataset.pilot === 'ready' &&
    !q('.pilot-preparation') && visible(q('.pilot-stage-image')) &&
    ['#fighter1','#fighter2'].every(s => {
      const actor=q(s + ' .pilot-fighter');
      return visible(actor) && actor.complete && actor.naturalWidth > 0;
    });
"""


def check(browser, expression, label, timeout=None):
    expression = f"Boolean({expression})"
    ok = browser.wait_for(expression, timeout) if timeout is not None else browser.eval(expression)
    assert ok, label
    print("PASS", label)


def visit(browser, url):
    if url.startswith('http'): url += ('&' if '?' in url else '?') + 'introStyle=original'
    browser.goto(url, settle=0.15)
    browser.eval(HELPERS)


def main():
    with server() as (url, gates, missing), Chrome(1280, 900) as c:
        c.call("Network.enable")
        c.call("Network.setCacheDisabled", cacheDisabled=True)
        gates[PORTRAITS] = Event()
        gates[STILL] = Event()
        visit(c, url + "?arena=snow&mode=local&seed=11&mute=1&intro=0")
        check(c, "artDirectionSign(q('#p1Roster .portrait > svg')) === 1 && "
                 "artDirectionSign(q('#p2Roster .portrait > svg')) === -1 && "
                 "artDirectionSign(q('#p2Detail .big-portrait > svg')) === -1 && "
                 "artDirectionSign(q('#p2Roster h3')) === 1 && "
                 "!visible(q('#p1Roster .portrait > svg')) && "
                 "!visible(q('#p2Detail .big-portrait > svg')) && visible(q('#startBtn'))",
              "Portrait preparation suppresses classic flash, keeps selection available and orients fallback art")
        gates[PORTRAITS].set()
        check(c, "artDirectionSign(q('#p1Roster .roster-render')) === 1 && "
                 "artDirectionSign(q('#p2Roster .roster-render')) === -1 && "
                 "artDirectionSign(q('#p2Detail .roster-render')) === -1 && "
                 "document.querySelectorAll('#p2Roster .roster-render').length === 6",
              "All real decoded 3D portraits preserve P2 direction", 4)

        c.eval("q('#p2Roster .char-card').click(); q('#startBtn').click()")
        c.pump(2.05)
        check(c, "q('#stage').dataset.pilot === 'loading' && "
                 "visible(q('.pilot-preparation')) && !classicTerrain().length && "
                 "!visible(q('#fighter1')) && !visible(q('#fighter2')) && "
                 "q('#phaseLabel').textContent === 'INTRO' && !q('#cmdGrid .cmd')",
              "Slow first load holds a neutral stage past the old cut-off, with no classic flash")
        gates[STILL].set()
        check(c, "readyArt() && !classicTerrain().length && "
                 "artDirectionSign(q('#fighter1 .pilot-fighter')) === 1 && "
                 "artDirectionSign(q('#fighter2 .pilot-fighter')) === -1 && "
                 "artDirectionSign(q('#fighter2 .nameplate')) === 1 && "
                 "artDirectionSign(q('#fighter2 .pilot-overlay')) === 1",
              "Both real fighters and stage appear together; no nameplate or shield reflection", 4)

        # Make one seeded P2 super finish the battle, through real command UI.
        c.eval("""
            window.idleP2 = q('#fighter2 .pilot-fighter').src;
            BeastBrawl.Game.state.fighters[0].hp = 1;
            q('#cmdGrid [data-key="5"]').click();
            q('#cmdGrid [data-key="3"]').click();
        """)
        check(c, "q('.cinematic-cutin.right .cutin-art > :is(svg,img)') && "
                 "artDirectionSign(q('.cinematic-cutin.right .cutin-art > :is(svg,img)')) === -1 && "
                 "artDirectionSign(q('.cinematic-cutin.right .cutin-name')) === 1",
              "P2 cinematic versus artwork and text have separate orientation", 5)
        check(c, "q('#fighter2').classList.contains('pose-release') && "
                 "q('#fighter2 .pilot-fighter').src !== idleP2 && "
                 "artDirectionSign(q('#fighter2 .pilot-fighter')) === -1 && "
                 "artDirectionSign(q('#fighter2')) === 1",
              "An actual P2 cast swaps WebP and stays left-facing through movement", 5)
        check(c, "ds.gameState === 'result' && ds.winner === '1' && "
                 "q('#resultPortrait .roster-render') && artDirectionSign(q('#resultPortrait .roster-render')) === -1 && "
                 "q('#resultTitle').textContent === '2P WIN!' && artDirectionSign(q('#resultTitle')) === 1",
              "P2 win portrait faces left; winner and result text remain readable", 9)

        for path in VIDEO:
            gates[path] = Event()
        c.viewport(390, 844, mobile=True, dpr=2)
        visit(c, url + "?arena=snow&seed=7&mute=1")
        c.eval("q('#startBtn').click()")
        check(c, "q('.pilot-intro') && visible(q('.pilot-preparation')) && "
                 "!classicTerrain().length && !visible(q('#fighter2'))",
              "At phone width, a held movie does not expose stale video or classic art", 4)
        for path in VIDEO:
            gates[path].set()
        check(c, "q('#stage').classList.contains('pilot-video-playing') && "
                 "q('.pilot-intro').readyState >= 2 && !visible(q('#fighter2')) && "
                 "!visible(q('.pilot-preparation'))",
              "Movie receives its first playable frame before the cover is dismissed", 4)
        c.eval("q('.pilot-skip').click()")
        check(c, "readyArt() && !q('.pilot-intro') && !classicTerrain().length",
              "Skip hands off directly from intro to complete 3D art", 4)

        visit(c, url + "?arena=snow&seed=11&mute=1")
        c.eval("q('#startBtn').click()")
        check(c, "readyArt() && !q('.pilot-intro') && !classicTerrain().length && "
                 "q('#phaseLabel').textContent === 'COMMAND'",
              "A naturally completed intro reveals the exact ready stage and enables commands", 6)

        gates[STILL] = Event()
        visit(c, url + "?arena=snow&intro=0&mute=1")
        c.eval("q('#startBtn').click(); q('#btnReset').click()")
        gates[STILL].set()
        c.pump(.35)
        check(c, "ds.gameState === 'select' && !q('.pilot-preparation') && !q('#stage').dataset.pilot",
              "Reset during loading removes cover and ignores stale completion")

        missing.add(STILL)
        c.eval("q('#startBtn').click()")
        check(c, "ds.art === 'classic' && !q('#stage').dataset.pilot && !q('.pilot-preparation') && "
                 "visible(q('#stage .city')) && visible(q('#fighter2 .fighter-figure > svg')) && "
                 "q('#battleLog').textContent.includes('這場改用經典畫面') && q('#cmdGrid .cmd:not(:disabled)')",
              "Missing 3D asset switches once to explicit playable classic art", 4)
        missing.clear()

        visit(c, url + "?art=classic&mute=1")
        c.eval("q('#startBtn').click()")
        check(c, "ds.art === 'classic' && !q('#stage').dataset.pilot && "
                 "artDirectionSign(q('#fighter1 .fighter-figure > svg')) === 1 && "
                 "artDirectionSign(q('#fighter2 .fighter-figure > svg')) === -1 && "
                 "artDirectionSign(q('#fighter2 .nameplate')) === 1 && visible(q('#cmdGrid .cmd'))",
              "Explicit classic battle is still direct and mirrored")

        visit(c, (ROOT / "index.html").as_uri() + "?art=3d&mute=1")
        c.eval("q('#startBtn').click()")
        check(c, "ds.art === 'classic' && !q('#stage').dataset.pilot && "
                 "visible(q('#fighter2 .fighter-figure > svg')) && artDirectionSign(q('#fighter2 .fighter-figure')) === -1",
              "Downloaded file:// continues without art packs")
        assert not c.errors(), c.errors()


if __name__ == "__main__":
    main()
