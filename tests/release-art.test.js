const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fighterIds, definition, keysFor, frame } = require('../js/render/release-art.js');
const { CHARACTERS, UTILITY_SKILLS } = require('../js/data/roster.js');

const packs = path.join(__dirname,'..','assets','pilot','packs');
const load = name => JSON.parse(fs.readFileSync(path.join(packs,name+'.json'),'utf8'));
const isWebp = encoded => {
  const b = Buffer.from(encoded,'base64');
  return b.toString('ascii',0,4)==='RIFF' && b.toString('ascii',8,12)==='WEBP';
};
const from = { x: 280, y: 292, ground:430 };
const to = { x: 720, y: 302, ground:442 };

test('all six characters have two color sets, five poses and select portraits', () => {
  assert.deepEqual(fighterIds,CHARACTERS.map(c=>c.id));
  const portraits=load('portraits');
  assert.equal(Object.keys(portraits).length,12);
  for (const id of fighterIds) {
    const sprites=load('cast-'+id);
    assert.equal(Object.keys(sprites).length,10);
    for (const color of ['a','b']) {
      assert.equal(isWebp(portraits[id+'-'+color]),true);
      for(const pose of ['idle','cast','hit','defend','ko']) assert.equal(isWebp(sprites[id+'-'+color+'-'+pose]),true);
    }
  }
});
test('all roster moves map to rendered assets and shields have both layers',()=>{
  const packs=new Map([...fighterIds,'shared'].map(id=>[id,load('fx-'+id)]));
  const keys=new Set([...CHARACTERS.flatMap(c=>c.skills),...UTILITY_SKILLS].map(s=>s.fx));
  assert.equal(keys.size,18);
  for(const k of keys) {
    if(k==='guard'||k==='bubble') {
      for(const family of k==='guard'?['guard']:['fortress','shield']) {
        for(const layer of ['front','back']) assert.equal(isWebp(packs.get(k==='guard'?'shared':'jelly')[family+'-'+layer]),true);
      }
    } else {
      const spec=definition[k];
      assert.ok(spec,k);
      assert.equal(isWebp(packs.get(spec[0])[k]),true);
    }
  }
  assert.equal([...packs.values()].flatMap(Object.keys).length,22); // 16 motions + 3 barriers × 2 layers
  assert.deepEqual(keysFor([{character:{id:'bear'}},{character:{id:'orca'}}]).sort(),['bass','ember','fireball','focus','heal','meteor','note']);
});
test('non-contact outcomes never show a hit-only effect; projectiles overshoot',()=>{
  assert.equal(frame('hammer',.72,false,0,from,to),null);
  assert.equal(frame('hammerquake',.79,false,0,from,to),null);
  assert.equal(frame('fireball',.77,true,0,from,to),null);
  assert.ok(frame('fireball',.79,false,0,from,to)[0]>to.x);
  assert.deepEqual(frame('hammer',.72,true,0,from,to).slice(0,2),[to.x,to.ground]);
  assert.deepEqual(frame('focus',.52,true,0,from,to).slice(0,2),[from.x,from.ground]);
  assert.deepEqual(frame('heal',.52,true,0,from,to).slice(0,2),[from.x,from.y-26]);
});
