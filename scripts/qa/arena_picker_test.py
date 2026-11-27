"""The real entry point: native arena controls, per-match random draws and lazy loading.

Run with CHROME=/path/to/chromium python3 scripts/qa/arena_picker_test.py.
"""
import re
from urllib.parse import urlsplit

from cdp import Chrome
from pilot_view_test import ROOT, check, server, visit


# Controlled independent arena RNG; the combat engine still receives the real seeded
# RNG untouched. Make the first choice non-snow to catch silent default fallbacks.
DRAW_SCRIPT = """
window.arenaDraws = 0;
const webCryptoDraw = crypto.getRandomValues.bind(crypto);
crypto.getRandomValues = (bytes) => {
  if (!(bytes instanceof Uint32Array) || bytes.length !== 1) return webCryptoDraw(bytes);
  const results = [0x60000000, 0xe0000000, 0x20000000, 0xa0000000];
  bytes[0] = results[window.arenaDraws++ % results.length];
  return bytes;
};
"""
IDS = ["random", "snow", "tide-harbor", "bamboo-theater", "thunder-terrace"]
LABELS = ["隨機場景", "雪山擂台", "潮汐玻璃港", "月下竹影戲臺", "雲階雷鼓台"]
READY = "readyArt() && q('#phaseLabel').textContent === 'COMMAND'"


def click(browser, selector):
    # CDP delivers normal mouse input to the displayed control, including the
    # native label-to-radio activation. JS is used solely for viewport positioning.
    x, y = browser.eval(f"""(() => {{
      const node = q({selector!r});
      node.scrollIntoView({{block: 'center'}});
      const r = node.getBoundingClientRect();
      return [r.x + r.width / 2, r.y + r.height / 2];
    }})()""")
    browser.click_at(x, y)


def arena_assets(browser):
    result = set()
    for event in browser.events:
        if event.get("method") != "Network.requestWillBeSent":
            continue
        path = urlsplit(event["params"]["request"]["url"]).path
        if re.fullmatch(r'/assets/(?:pilot|arenas/[^/]+)/(?:stage\.webp|intro[^/]*\.(?:webm|mp4))', path):
            result.add(path)
    return result


def ready(browser, arena, draws):
    check(browser, READY + f" && q('#stage[data-arena]').dataset.arena === {arena!r} && arenaDraws === {draws}",
          f"{arena} is reported and displayed after {draws} draws", 8)
    directory = "/assets/pilot" if arena == "snow" else "/assets/arenas/" + arena
    assert directory + "/stage.webp" in arena_assets(browser), arena_assets(browser)
    assert all(path.startswith(directory + "/") for path in arena_assets(browser)), arena_assets(browser)


def fight_turn(browser, left, right):
    check(browser, "q('#cmdGrid').dataset.side === '0' && q('#cmdGrid .cmd:not(:disabled)')",
          "1P command is available", 4)
    browser.key(str(left), code=f"Digit{left}")
    check(browser, "q('#cmdGrid').dataset.side === '1' && q('#cmdGrid .cmd:not(:disabled)')",
          "2P command is available", 4)
    browser.key(str(right), code=f"Digit{right}")


def snapshot(browser):
    return browser.eval("""({
        combatants: BeastBrawl.Game.state.fighters.map(({hp, mp, shield, poison, stun, weaken, slow}) =>
          [hp, mp, shield, poison, stun, weaken, slow]),
        actionLog: [...document.querySelectorAll('#battleLog .log-entry')].map(el => el.textContent)
    })""")


def main():
    with server() as (url, _gates, _missing), Chrome(1280, 900) as browser:
        browser.call("Network.enable")
        browser.call("Network.setCacheDisabled", cacheDisabled=True)
        browser.call("Page.addScriptToEvaluateOnNewDocument", source=DRAW_SCRIPT)
        browser.viewport(320, 700, mobile=True, dpr=2)
        visit(browser, url + "?intro=0&mute=1")
        assert browser.eval("[...document.querySelectorAll('#arenaChooser input')].map(x => x.value)") == IDS
        assert browser.eval("[...document.querySelectorAll('.arena-option span')].map(x => x.textContent)") == LABELS
        check(browser, """q('#arenaChooser legend').textContent === '對戰場景' &&
          q('#arenaRandomHint').textContent.includes('4 個場景') &&
          q('input[name=arena]:checked').value === 'random' &&
          [...document.querySelectorAll('.arena-option')].every(el => {
            const r = el.getBoundingClientRect();
            return visible(el) && r.left >= 0 && r.right <= 320 && r.height >= 44 &&
              el.querySelector('input').type === 'radio';
          }) && arenaDraws === 0""", "Five native options fit at 320px; random default, separate four-scene hint")
        assert not arena_assets(browser), arena_assets(browser)

        browser.eval("q('.mode[data-mode=demo]').focus()")
        browser.key("Tab")
        check(browser, """document.activeElement.value === 'random' &&
          document.activeElement.matches('input:focus-visible') &&
          getComputedStyle(document.activeElement.parentElement).outlineWidth === '3px'""",
              "Real Tab focuses the checked radio and visibly outlines its tile")
        browser.key("ArrowRight")
        check(browser, "document.activeElement.value === 'snow' && q('input[name=arena]:checked').value === 'snow'",
              "Real right-arrow changes the focused and checked radio")
        browser.key("Enter")
        check(browser, "ds.gameState === 'select'", "Enter does not skip out of the focused radio group")
        browser.key("Tab")
        check(browser, """document.activeElement.matches('button[data-random="1"]')""",
              "Tab leaves the radio group in one step")
        click(browser, ".arena-option:nth-child(4) span")
        check(browser, "q('input[name=arena]:checked').value === 'bamboo-theater' && arenaDraws === 0",
              "Mouse click on the visible caption selects bamboo without a draw")
        assert not arena_assets(browser), arena_assets(browser)
        click(browser, "#startBtn")
        ready(browser, "bamboo-theater", 0)

        browser.viewport(1280, 900)
        control_query = "?mode=local&intro=0&speed=4&mute=1&seed=11"
        visit(browser, url + control_query + "&arena=snow")
        check(browser, "q('input[name=arena]:checked').value === 'snow' && arenaDraws === 0",
              "Direct arena query selects a fixed radio")
        click(browser, "#startBtn")
        ready(browser, "snow", 0)
        fight_turn(browser, 1, 1)
        check(browser, "BeastBrawl.Game.state.round === 2 && q('#phaseLabel').textContent === 'COMMAND'",
              "Fixed scene leaves the first combat turn playable", 6)
        fixed_snapshot = snapshot(browser)

        visit(browser, url + control_query + "&arena=does-not-exist")
        check(browser, "q('input[name=arena]:checked').value === 'random' && arenaDraws === 0",
              "Unknown arena query starts with random checked, but does not yet draw")
        click(browser, "#startBtn")
        ready(browser, "tide-harbor", 1)
        fight_turn(browser, 1, 1)
        check(browser, """BeastBrawl.Game.state.round === 2 && q('#phaseLabel').textContent === 'COMMAND' &&
          q('#stage').dataset.arena === 'tide-harbor' && arenaDraws === 1""",
              "A battle turn does not redraw or replace the stage", 6)
        assert snapshot(browser) == fixed_snapshot, "independent scene draw changed the seeded battle"
        print("PASS Fixed and random scenes produce the same actual seeded combat output")
        assert arena_assets(browser) == {"/assets/arenas/tide-harbor/stage.webp"}, arena_assets(browser)

        # Force an imminent KO using the existing readonly QA interface into the
        # engine state, then click the genuine rematch button at the result screen.
        for _ in range(3):
            browser.eval("BeastBrawl.Game.state.fighters[0].hp = 1")
            current = browser.eval("BeastBrawl.Game.state.round")
            fight_turn(browser, 5, 3)
            check(browser, f"ds.gameState === 'result' || BeastBrawl.Game.state.round > {current}",
                  "The near-KO fixture completes a turn", 7)
            if browser.eval("ds.gameState === 'result'"):
                break
        check(browser, "ds.gameState === 'result' && arenaDraws === 1",
              "A finished match still used exactly one draw")
        click(browser, "#rematchBtn")
        check(browser, READY + " && q('#stage').dataset.arena === 'thunder-terrace' && arenaDraws === 2",
              "Real Rematch button draws once more and displays the new result", 8)
        assert arena_assets(browser) == {
            "/assets/arenas/tide-harbor/stage.webp", "/assets/arenas/thunder-terrace/stage.webp"
        }, arena_assets(browser)
        click(browser, "#btnReset")
        check(browser, "q('input[name=arena]:checked').value === 'random' && !q('#stage').dataset.arena && arenaDraws === 2",
              "Returning to select keeps the choice and clears the resolved arena")

        # The query cannot activate art, a random draw or an arena fetch in classic/file mode.
        for address in (url + "?art=classic&arena=tide-harbor&mute=1",
                        (ROOT / "index.html").as_uri() + "?arena=tide-harbor&mute=1"):
            visit(browser, address)
            check(browser, "!visible(q('#arenaChooser'))", "Classic/offline mode hides unsupported scene options")
            click(browser, "#startBtn")
            check(browser, """ds.gameState === 'battle' && ds.art === 'classic' &&
              !q('#stage').dataset.arena && arenaDraws === 0""",
                  "Classic/offline battle draws no scene")
            assert not arena_assets(browser), arena_assets(browser)

        assert not browser.errors(), browser.errors()


if __name__ == "__main__":
    main()
