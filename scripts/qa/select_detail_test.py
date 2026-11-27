"""Real Chromium regression for narrow character details and matchup colors.

Run with CHROME=/path/to/chromium python3 scripts/qa/select_detail_test.py.
"""
from pathlib import Path

from cdp import Chrome

ROOT = Path(__file__).resolve().parents[2]
URL = (ROOT / "index.html").as_uri() + "?art=classic&mute=1"
LAYOUT = """
(() => {
  const root = document.documentElement;
  const issues = [];
  const check = (ok,label) => { if (!ok) issues.push(label); };
  const inside = (inner, outer) => inner.left >= outer.left-1 && inner.right <= outer.right+1;
  check(root.scrollWidth <= innerWidth, 'root width');
  for (const [i, panel] of [...document.querySelectorAll('.setup-grid > .panel')].entries()) {
    const detail = panel.querySelector('.fighter-detail');
    const cardList = panel.querySelector('.roster');
    const clip = panel.getBoundingClientRect();
    const panelCheck = (ok,label) => check(ok, (i+1) + 'P ' + label);
    const skills = [...detail.querySelectorAll('.skill-list li')];
    panelCheck(skills.length === 3,'three skill cards');
    panelCheck(cardList.scrollWidth <= cardList.clientWidth + 1, 'roster width');
    panelCheck(detail.scrollWidth <= detail.clientWidth + 1, 'detail width');
    for(const item of detail.querySelectorAll('.detail, .palette-row, .stats, .stat, .skill-list, .skill-list li')) {
      panelCheck(item.scrollWidth <= item.clientWidth+1 && inside(item.getBoundingClientRect(),clip),
        item.className || item.textContent.slice(0,20));
    }
    for(const item of detail.querySelectorAll('.job, h3, .passive, .skill-list li > *, .stat-head > *, .palette-row > *')) {
      const rect = item.getBoundingClientRect();
      const row = item.closest('.skill-list li,.stat,.palette-row') || detail;
      const range = document.createRange();
      range.selectNodeContents(item);
      panelCheck(rect.width > 0 && rect.height > 0 && inside(rect,clip), 'visible ' + item.textContent);
      panelCheck([...range.getClientRects()].every(r => inside(r,row.getBoundingClientRect())),
        'wrapped ' + item.textContent);
    }
    for(const card of cardList.querySelectorAll('.char-card')) {
      panelCheck(inside(card.getBoundingClientRect(),clip), 'roster card edge');
      panelCheck(inside(card.querySelector('svg').getBoundingClientRect(),
        card.querySelector('.portrait').getBoundingClientRect()), 'complete artwork');
    }
    const art=detail.querySelector('.big-portrait svg');
    const face=new DOMMatrix(getComputedStyle(art).transform).a;
    panelCheck(Math.sign(face) === (i ? -1 : 1), 'portrait facing');
  }
  return issues;
})()
"""
PICKS = "[1,2].map(p=>Number(document.querySelector('#p'+p+'Detail .palette[aria-pressed=true]').dataset.p))"
USED = "BeastBrawl.Game.state.fighters.map(f=>f.paletteIndex)"
ENDED = "document.documentElement.dataset.gameState==='result' && BeastBrawl.Game.state.ended"


def choose(browser, player, index):
    browser.eval(f"document.querySelector('#p{player}Roster [data-index=\"{index}\"]').click()")


def color(browser, player, index):
    browser.eval(f"document.querySelector('#p{player}Detail [data-p=\"{index}\"]').click()")


def main():
    with Chrome(320, 744) as c:
        for width in (320, 360, 390):
            c.viewport(width, 744, mobile=True, dpr=2)
            c.goto(URL, settle=.1)
            assert c.eval(PICKS) == [0, 1], width
            # Visit all six on both sides, including simultaneous same-fighter
            # selections, to cover the longest passive/name/skill texts.
            for index in range(6):
                choose(c, 1, index)
                choose(c, 2, index)
                issues = c.eval(LAYOUT)
                assert not issues, (width, index, issues)
            print(f"PASS {width}px: all six characters, both full detail panes, no clipping")

        c.goto(URL + "&mode=demo&speed=4&seed=11")
        assert c.eval(PICKS) == [0, 1]
        color(c, 2, 0)
        assert c.eval(PICKS) == [0, 0], 'unrelated characters may share a color'
        choose(c, 2, 0)
        assert c.eval(PICKS) == [0, 1], 'same-fighter selection gives way on its own side'
        color(c, 1, 1)
        assert c.eval(PICKS) == [1, 0], 'manual color selection is respected in a mirror match'
        choose(c, 2, 1)
        assert c.eval(PICKS) == [1, 0], 'ordinary character selection leaves independent colors alone'
        c.eval("document.querySelector('#startBtn').click()")
        assert c.eval(USED) == [1, 0]
        assert c.wait_for(ENDED, 50), 'seeded duel should complete normally'
        used = c.eval(USED)
        c.eval("document.querySelector('#rematchBtn').click()")
        assert c.eval(USED) == used and not c.eval("BeastBrawl.Game.state.ended")
        assert c.wait_for(ENDED, 50), 'seeded rematch should complete normally'
        c.eval("document.querySelector('#backBtn').click()")
        assert c.eval(PICKS) == used
        color(c, 2, 1)
        assert c.eval(PICKS) == [1, 1], 'an explicit edit supersedes the finished match'
        assert not c.errors(), c.errors()
        print("PASS initial A/B, independent edits, mirror guard, played-out match, rematch and return to select")


if __name__ == "__main__":
    main()
