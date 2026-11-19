"""End-to-end smoke test in headless Chrome (stdlib only).

    python3 scripts/qa/smoke_test.py [--shots DIR]

Checks, failing with exit code 1 on any problem:
  1. The select screen renders six fighters per side without console errors.
  2. A seeded CPU-vs-CPU spectator battle (?mode=demo&autostart=1&speed=4&mute=1)
     reaches the result screen.
  3. A 1P-vs-CPU battle can be played with the keyboard only (1–5 / Enter).
  4. Leaving mid-resolution and starting again never leaks the old battle.
  5. The layout has no horizontal overflow at 390 px.
"""
import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from cdp import Chrome  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
URL = 'file://' + os.path.join(ROOT, 'index.html')
failures = []


def check(cond, label):
    print(('PASS ' if cond else 'FAIL ') + label)
    if not cond:
        failures.append(label)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--shots', help='directory for screenshots')
    args = ap.parse_args()
    shot = (lambda c, name: c.screenshot(os.path.join(args.shots, name))) if args.shots else (lambda c, name: None)
    if args.shots:
        os.makedirs(args.shots, exist_ok=True)

    with Chrome(1280, 900) as c:
        c.goto(URL + '?mute=1')
        check(c.eval("document.querySelectorAll('#p1Roster .char-card').length") == 6, 'roster renders 6 fighters (1P)')
        check(c.eval("document.querySelectorAll('#p2Roster .char-card').length") == 6, 'roster renders 6 fighters (2P)')
        check(c.eval("document.documentElement.dataset.gameState") == 'select', 'starts on the select screen')
        shot(c, 'select.png')

        # 2. Spectator battle to completion.
        c.goto(URL + '?mode=demo&autostart=1&speed=4&mute=1&seed=7')
        done = c.wait_for("document.documentElement.dataset.gameState === 'result'", timeout=240)
        check(done, 'CPU-vs-CPU spectator battle reaches the result screen')
        if done:
            check(c.eval("document.querySelectorAll('#resultStats td').length") == 12, 'result screen shows battle stats')
            shot(c, 'result.png')

        # 3. Keyboard-only 1P vs CPU.
        c.goto(URL + '?speed=4&mute=1&seed=11')
        c.key('Enter')
        check(c.wait_for("document.documentElement.dataset.gameState === 'battle'", 5), 'Enter starts a battle')
        rounds = 0
        while rounds < 80 and c.eval("document.documentElement.dataset.gameState") == 'battle':
            ready = c.wait_for("!!document.querySelector('#cmdGrid .cmd:not(:disabled)') || document.documentElement.dataset.gameState !== 'battle'", 30)
            if not ready or c.eval("document.documentElement.dataset.gameState") != 'battle':
                break
            if c.eval("!!document.querySelector('#stunSkip')"):
                c.key('Enter')
            else:
                digit = c.eval("document.querySelector('#cmdGrid .cmd:not(:disabled)').dataset.key")
                c.key(digit, code=f'Digit{digit}')
            rounds += 1
            c.pump(0.15)
        if rounds == 1:
            shot(c, 'battle.png')
        check(c.wait_for("document.documentElement.dataset.gameState === 'result'", 30), f'keyboard-only battle finishes ({rounds} commands)')

        # 4. Leave mid-resolution, start again: the new battle must stay clean.
        c.goto(URL + '?mute=1')
        c.eval("document.querySelector('#startBtn').click()")
        c.wait_for("!!document.querySelector('#cmdGrid .cmd:not(:disabled)')", 10)
        c.eval("document.querySelector('#cmdGrid .cmd[data-key=\"3\"]').click()")
        c.pump(0.7)
        c.eval("document.querySelector('#btnReset').click(); document.querySelector('#startBtn').click()")
        c.pump(5)
        log = c.eval("[...document.querySelectorAll('#battleLog .log-entry')].map(e => e.textContent)")
        check(log == [], f'restarting mid-resolution leaves the new battle untouched ({log})')

        errors = c.errors()
        check(not errors, f'no console errors ({errors})')

    with Chrome(390, 844) as c:
        c.viewport(390, 844, mobile=True, dpr=2)
        c.goto(URL + '?mute=1')
        check(c.eval('document.documentElement.scrollWidth <= window.innerWidth'), 'no horizontal overflow at 390px (select)')
        c.eval("document.querySelector('#startBtn').click()")
        c.pump(1)
        check(c.eval('document.documentElement.scrollWidth <= window.innerWidth'), 'no horizontal overflow at 390px (battle)')
        shot(c, 'battle-mobile.png')
        check(not c.errors(), 'no console errors on mobile')

    print(f'\n{len(failures)} failure(s)')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
