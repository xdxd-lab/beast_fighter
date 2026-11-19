/**
 * Beast Brawl — roster data.
 *
 * Pure data: six fighters (stats, passive, three skills, two palettes each) plus the two
 * utility commands every fighter shares. Balance numbers live here and are consumed by
 * js/core/engine.js. Loadable in the browser (window.BeastBrawl.Roster) and in Node tests.
 *
 * Skill fields
 *   id     'basic' | 's1' | 's2' | 'guard' | 'focus'
 *   cost   MP cost
 *   type   damage | magic | pierce | stun | slow | weaken | heal | shield | guard | focus
 *   power  base power (damage, heal amount or shield amount)
 *   acc    hit chance in percent
 *   crit   critical-hit chance override (default RULES.baseCritChance)
 *   stun   chance to stagger the target (type 'stun' only)
 *   fx     visual/audio effect key used by the renderer and the audio engine
 *
 * colors: two palettes of [body, accent, outfit] used by js/render/sprites.js.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.BeastBrawl = root.BeastBrawl || {}).Roster = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const CHARACTERS = [
    {
      id: 'bear', name: '波洛', animal: '北極熊', job: '烈焰法師',
      hp: 104, mp: 118, atk: 12, def: 7, spd: 9,
      passive: '極地爐心：HP 低於 50% 時，魔法與技能傷害 +12%。看起來最適合冰系近戰，偏偏專精火焰。',
      skills: [
        { id: 'basic', name: '火星彈', cost: 0, desc: '小型遠程火彈，不消耗 MP', type: 'magic', power: 14, acc: 97, fx: 'ember' },
        { id: 's1', name: '反季節火球', cost: 15, desc: '高速火球，穿透大量防禦', type: 'magic', power: 28, acc: 95, fx: 'fireball' },
        { id: 's2', name: '白夜隕星', cost: 27, desc: '高威力隕火，22% 使對手失衡', type: 'stun', power: 34, acc: 89, stun: 0.22, fx: 'meteor' },
      ],
      colors: [['#f3fbff', '#91d9ff', '#d83b25'], ['#ffe7d1', '#f3a56f', '#69243b']],
    },
    {
      id: 'elephant', name: '坦波', animal: '大象', job: '遠擊砲手',
      hp: 138, mp: 78, atk: 13, def: 12, spd: 5,
      passive: '長距校準：專屬技能（非普通攻擊）傷害 +8%。體型像坦克，卻堅持站遠處轟炸。',
      skills: [
        { id: 'basic', name: '鼻砲水彈', cost: 0, desc: '用象鼻發射高壓水彈', type: 'magic', power: 15, acc: 97, fx: 'water' },
        { id: 's1', name: '耳翼暴風', cost: 16, desc: '搧出遠程暴風並降低速度', type: 'slow', power: 22, acc: 94, fx: 'wind' },
        { id: 's2', name: '地脈震波', cost: 22, desc: '跺地讓震波沿地面奔向敵人', type: 'stun', power: 29, acc: 91, stun: 0.28, fx: 'shockwave' },
      ],
      colors: [['#9c78b9', '#cdb9da', '#644583'], ['#9ed8eb', '#d9f3fb', '#4f91ae']],
    },
    {
      id: 'panda', name: '糰糰', animal: '熊貓', job: '疾影刺客',
      hp: 96, mp: 94, atk: 16, def: 6, spd: 18,
      passive: '懶態瞬身：若本回合先行動，造成傷害 +12%。看起來最想躺平，真正開打卻是全隊最快。',
      skills: [
        { id: 'basic', name: '竹葉瞬步', cost: 0, desc: '懶洋洋抬手，下一瞬間已完成近身打擊', type: 'damage', power: 16, acc: 98, fx: 'shadow' },
        { id: 's1', name: '竹影飛刃', cost: 14, desc: '高速旋轉竹葉，無視大量防禦', type: 'pierce', power: 24, acc: 96, fx: 'leaf' },
        { id: 's2', name: '一秒七掌', cost: 23, desc: '七段殘影掌擊，暴擊率高', type: 'damage', power: 29, acc: 93, crit: 0.30, fx: 'shadow' },
      ],
      colors: [['#f6f3eb', '#24262c', '#70b864'], ['#e8e5ff', '#4a4267', '#b46bd2']],
    },
    {
      id: 'hummingbird', name: '啾槌', animal: '蜂鳥', job: '巨槌狂戰士',
      hp: 98, mp: 72, atk: 19, def: 5, spd: 13,
      passive: '羽量暴怒：HP 低於 35% 時，所有攻擊傷害 +18%。明明輕到能停在花上，偏偏只愛揮超重武器。',
      skills: [
        { id: 'basic', name: '小翼大槌', cost: 0, desc: '用比自己還大的戰槌敲擊', type: 'damage', power: 18, acc: 96, fx: 'hammer' },
        { id: 's1', name: '蜂鳴衝槌', cost: 15, desc: '高速振翅後帶著巨槌直線衝撞', type: 'damage', power: 27, acc: 94, crit: 0.22, fx: 'airhammer' },
        { id: 's2', name: '天空墜星槌', cost: 22, desc: '從高處俯衝重砸，30% 使對手失衡', type: 'stun', power: 31, acc: 90, stun: 0.30, fx: 'hammerquake' },
      ],
      colors: [['#58d5b2', '#e6fff6', '#f35d88'], ['#67a5ff', '#edf4ff', '#ffb248']],
    },
    {
      id: 'orca', name: '歐洛', animal: '虎鯨', job: '深海吟遊詩人',
      hp: 122, mp: 108, atk: 10, def: 9, spd: 9,
      passive: '深海安可：使用「凝神」時額外回復 6 HP。看起來像海中霸主，實際上更在意音準與舞台效果。',
      skills: [
        { id: 'basic', name: '鯨歌音符', cost: 0, desc: '把一枚低音音符送向對手', type: 'magic', power: 13, acc: 98, fx: 'note' },
        { id: 's1', name: '潮汐和弦', cost: 17, desc: '低頻和弦造成傷害並降低攻擊', type: 'weaken', power: 21, acc: 95, fx: 'bass' },
        { id: 's2', name: '鯨歌安魂曲', cost: 22, desc: '沉浸式演唱，回復 28 HP', type: 'heal', power: 28, acc: 100, fx: 'heal' },
      ],
      colors: [['#172235', '#f5f7fa', '#55c9ff'], ['#493577', '#fff0fb', '#ff71b9']],
    },
    {
      id: 'jelly', name: '璃璃', animal: '水母', job: '重裝聖騎士',
      hp: 128, mp: 92, atk: 9, def: 14, spd: 6,
      passive: '無骨重甲：所有專屬護盾效果 +25%。全隊最柔軟、沒有骨頭，卻是最難打穿的防線。',
      skills: [
        { id: 'basic', name: '麻麻聖光', cost: 0, desc: '用溫和表情放出一發麻痺電光', type: 'magic', power: 13, acc: 98, fx: 'electric' },
        { id: 's1', name: '水晶聖盾', cost: 16, desc: '展開透明水膜，獲得 24 點基礎護盾', type: 'shield', power: 24, acc: 100, fx: 'bubble' },
        { id: 's2', name: '不動水母城', cost: 28, desc: '堆疊大型結界，獲得 40 點基礎護盾', type: 'shield', power: 40, acc: 100, fx: 'bubble' },
      ],
      colors: [['#eef7d4', '#8dcfe9', '#5a78cf'], ['#ffd7ee', '#c7a8ef', '#7858b6']],
    },
  ];

  const UTILITY_SKILLS = [
    { id: 'guard', name: '防禦', cost: 0, desc: '本回合承傷 -45%', type: 'guard', fx: 'guard' },
    { id: 'focus', name: '凝神', cost: 0, desc: '回復 14 MP', type: 'focus', fx: 'focus' },
  ];

  return Object.freeze({ CHARACTERS, UTILITY_SKILLS });
});
