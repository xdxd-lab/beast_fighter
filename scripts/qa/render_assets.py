"""Regenerates assets/icon-180.png and assets/og-image.png from the live game (headless Chrome).

    python3 scripts/qa/render_assets.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Chrome  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
ASSETS = os.path.join(ROOT, 'assets')

with Chrome(180, 180) as c:
    c.goto('file://' + os.path.join(ASSETS, 'icon.svg'))
    c.eval("document.documentElement.setAttribute('width','180');document.documentElement.setAttribute('height','180');document.documentElement.style.cssText='display:block;margin:0'")
    c.screenshot(os.path.join(ASSETS, 'icon-180.png'))

# Social preview: a staged mid-battle frame at 1200×630.
with Chrome(1200, 630) as c:
    c.goto('file://' + os.path.join(ROOT, 'index.html') + '?mute=1&seed=3')
    c.eval("""(() => {
      document.querySelectorAll('#p1Roster .char-card')[0].click();
      document.querySelectorAll('#p2Roster .char-card')[5].click();
      document.querySelector('#startBtn').click();
    })()""")
    c.pump(1.4)
    c.eval("[...document.querySelectorAll('#cmdGrid .cmd:not(:disabled)')][0].click()")
    c.wait_for("document.querySelector('#frameCallout').textContent.includes('3/5')", 10, 0.03)
    c.pump(0.12)
    c.eval("""(() => {
      const s = document.getElementById('stage');
      const t = document.createElement('div');
      t.style.cssText = 'position:absolute;left:28px;top:20px;z-index:40;font:italic 1000 54px/0.95 "Arial Black",sans-serif;color:#f7f5ed;text-shadow:0 6px 0 rgba(0,0,0,.35);letter-spacing:-.03em';
      t.innerHTML = '萌獸鬥技場<div style="font-size:20px;color:#ffd45c;letter-spacing:.2em;margin-top:10px">BEAST BRAWL · TURN FIGHTER</div>';
      s.appendChild(t);
      document.querySelector('.topbar').style.display = 'none';
      document.querySelector('.hud').style.display = 'none';
      document.querySelector('.battle-bottom').style.display = 'none';
      document.querySelector('main').style.padding = '0';
      document.querySelector('.site-footer').style.display = 'none';
      document.getElementById('frameCallout').style.display = 'none';
      s.style.height = '630px'; s.style.borderRadius = '0'; s.style.border = '0';
    })()""")
    c.pump(0.05)
    c.screenshot(os.path.join(ASSETS, 'og-image.png'))
print('assets rendered')

# README screenshots.
DOCS = os.path.join(ROOT, 'docs', 'images')
os.makedirs(DOCS, exist_ok=True)
with Chrome(1280, 900) as c:
    c.goto('file://' + os.path.join(ROOT, 'index.html') + '?mute=1&seed=21')
    c.screenshot(os.path.join(DOCS, 'select.png'))
    c.eval("""(() => {
      document.querySelectorAll('#p1Roster .char-card')[5].click();
      document.querySelectorAll('#p2Roster .char-card')[3].click();
      document.querySelector('#startBtn').click();
    })()""")
    c.pump(1.4)
    c.eval("document.querySelector('#cmdGrid .cmd[data-key=\"2\"]').click()")
    c.wait_for("document.querySelector('#frameCallout').textContent.includes('4/5')", 15, 0.03)
    c.pump(0.05)
    c.screenshot(os.path.join(DOCS, 'battle.png'))
    c.pump(5)
    c.screenshot(os.path.join(DOCS, 'battle-hud.png'))
with Chrome(390, 844) as c:
    c.viewport(390, 844, mobile=True, dpr=2)
    c.goto('file://' + os.path.join(ROOT, 'index.html') + '?mute=1')
    c.eval("document.querySelector('#startBtn').click()")
    c.pump(1.5)
    c.screenshot(os.path.join(DOCS, 'mobile.png'))
print('docs screenshots rendered')
