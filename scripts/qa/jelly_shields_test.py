"""Verify both authored shield numbers from selection through real combat UI."""
from cdp import Chrome
from pilot_view_test import check, server, visit
from arena_picker_test import click, fight_turn

def main():
    with server() as (url, _gates, _missing), Chrome(1280, 850) as browser:
        visit(browser, url + '?mode=local&speed=4&seed=21&mute=1&arena=snow&intro=0')
        for side in (1, 2):
            click(browser, f'#p{side}Roster .char-card[data-index="5"]')
            check(browser, f"q('#p{side}Detail').textContent.includes('獲得 32 點護盾') "
                           f"&& q('#p{side}Detail').textContent.includes('獲得 52 點護盾') "
                           f"&& !q('#p{side}Detail').textContent.includes('+30%')",
                  f'P{side} selection correctly describes shield amounts with no bonus')
        click(browser,'#startBtn')
        check(browser,"q('#phaseLabel').textContent==='COMMAND' && BeastBrawl.Game.state", 'Match is ready',8)
        fight_turn(browser,2,3)
        check(browser, "BeastBrawl.Game.state.round === 2 && q('#phaseLabel').textContent==='COMMAND'", 'Shield turn finished',8)
        assert browser.eval("BeastBrawl.Game.state.fighters.map(f=>f.shield)") == [32,52]
        check(browser,"q('#battleLog').textContent.includes('獲得 32 點護盾') && "
                      "q('#battleLog').textContent.includes('獲得 52 點護盾') && "
                      "!q('#battleLog').textContent.includes('無骨重甲強化')",
              'The live outcomes and log agree without a duplicate multiplier')
        assert not browser.errors(),browser.errors()

if __name__=='__main__':
    main()
