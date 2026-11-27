'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Intros = require('../js/render/intro-plans');
const Arenas = require('../js/render/arenas');
test('each arena has exactly three paired camera paths', () => {
  assert.deepEqual(Intros.styles, ['original', 'aerial', 'diagonal']);
  for (const arena of Arenas.list) {
    const selected = Intros.styles.map((id,i) => Intros.choose(arena, null, () => i));
    const root = arena.webm.slice(0,-'intro.webm'.length);
    assert.deepEqual(selected.map(x => x.webm), ['intro.webm','intro-aerial.webm','intro-diagonal.webm'].map(x=>root+x));
    assert.deepEqual(selected.map(x => x.mp4), selected.map(x=>x.webm.replace(/webm$/,'mp4')));
  }
});
test('a trusted forced choice never draws; unknown options remain random', () => {
  const arena=Arenas.list[0];
  assert.equal(Intros.choose(arena,'aerial',()=>{throw Error('unexpected draw');}).id,'aerial');
  let calls=0;
  assert.equal(Intros.choose(arena,'../../fake',()=>{calls+=1;return 2;}).id,'diagonal');
  assert.equal(calls,1);
});

test('every defined intro style ships both browser encodings and stays within budget', () => {
  const fs = require('node:fs'), path = require('node:path');
  const absoluteAsset = p => path.resolve(__dirname,'..',p);
  for (const arena of Arenas.list) {
    for (const style of Intros.styles) {
      const { webm, mp4 } = Intros.choose(arena, style);
      for (const filename of [webm, mp4]) {
        const data = fs.readFileSync(absoluteAsset(filename));
        assert.ok(data.length > 0 && data.length <= (filename.endsWith('.webm') ? 350000 : 500000), filename);
        if (filename.endsWith('.webm')) assert.equal(data.subarray(0,4).toString('hex'), '1a45dfa3', filename);
        else assert.equal(data.toString('ascii',4,8), 'ftyp', filename);
      }
    }
  }
});
