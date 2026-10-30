export async function surveyCacheBindingCorpus(createTrial) {
  const scenario = { id: 'physical-cache-binding-corpus', horizonTicks: 128, physicalLaneCount: 1, laneHeight: 96, cohort: { size: 1 },
    geometry: { solid: [{ x: 8, y: 72, width: 256, height: 24 }], steel: [] }, worldOptions: { assists: false } };
  const trial = await createTrial(scenario), foreign = await createTrial(scenario), failures = [];
  const require = (condition, text) => { if (!condition) throw new Error(text); };
  try {
    const world = trial.world, seed = world.laneSeeds[0], hash = () => trial.snapshot().physicalStateHash;
    world.hasGroundAt(36, 72); const good = world._laneChunk[0], wrong = world.terrain.getChunk(seed, 4), before = hash();
    const refuse = (kind, field, mutate, restore) => {
      const expected = hash(); mutate(); let failure;
      try { hash(); } catch (error) { failure = error; }
      finally { restore(); }
      require(failure?.code === 'unverified-world-cache-binding' && failure.field === field, 'Unproved ' + kind + ' was not precisely refused: ' + JSON.stringify(failure));
      require(hash() === expected, 'Repaired ' + kind + ' did not recover'); failures.push({ kind, field: failure.field, code: failure.code, sourceCode: failure.sourceCode });
    };
    refuse('wrong-lane-chunk', 'lane-collision', () => { world._laneChunk[0] = wrong; require(world.hasGroundAt(36, 72) === false, 'Collision counterexample did not change real ground'); }, () => { world._laneChunk[0] = good; });
    refuse('wrong-collision-slot', 'collision-slot', () => { world._collisionSlots[0] = wrong; }, () => { world._collisionSlots[0] = good; });
    refuse('wrong-lane-index', 'lane-collision', () => { world._laneChunkIndex[0] = 4; }, () => { world._laneChunkIndex[0] = 0; });
    const foreignChunk = foreign.world.terrain.getChunk(foreign.world.laneSeeds[0], 0);
    refuse('foreign-source-chunk', 'lane-collision', () => { world._laneChunk[0] = foreignChunk; }, () => { world._laneChunk[0] = good; });
    const key = seed + ':0'; world.terrain.collision.delete(key); require(hash() === before, 'Pristine evicted but retained chunk changed identity');
    refuse('altered-evicted-source', 'collision-slot', () => { good.solid[0] ^= 1; }, () => { good.solid[0] ^= 1; });
    world.terrain.getChunk(seed, 0); require(hash() === before, 'Pristine rebuilt source invalidated its held alias');
    const current = world.terrain.collision.get(key);
    refuse('divergent-held-source', 'collision-slot', () => { current.solid[0] ^= 1; }, () => { current.solid[0] ^= 1; });
    world.setGroundAt(36, 60); world.hasGroundAt(36, 60);
    const editBefore = hash(), edit = world._laneEdits[0], editIndex = world._laneEditIndex[0], slot = editIndex & (world._editSlots - 1), detached = new Uint8Array(edit.length);
    refuse('detached-lane-edit', 'lane-edit', () => { world._laneEdits[0] = detached; require(world.hasGroundAt(36, 60) === false, 'Edit counterexample did not change real ground'); }, () => { world._laneEdits[0] = edit; });
    refuse('detached-edit-slot', 'edit-slot', () => { world._editCache[slot] = detached; }, () => { world._editCache[slot] = edit; });
    const ownerKey = world.editChunks._lastKey, ownerChunk = world.editChunks._lastChunk;
    refuse('detached-edit-owner', 'edit-owner-last', () => { world.editChunks._lastChunk = detached; }, () => { world.editChunks._lastKey = ownerKey; world.editChunks._lastChunk = ownerChunk; });
    world.editChunks.compactExcept(new Set(), 1); require(hash() === editBefore, 'Legitimate compaction changed physical evidence');
    require(world.hasGroundAt(36, 60), 'Cold edit failed to restore actual ground'); require(hash() === editBefore, 'Rehydrated edit changed physical evidence');
    for (const key of ['missing-observer-key', Number.MAX_SAFE_INTEGER]) { world.editChunks.get(key); require(hash() === editBefore, 'Unreachable observer lookup changed physical evidence'); }
    let getters = 0; const getter = () => { getters++; throw new Error('Evidence invoked a query hook'); }, views = [world._collisionIndices, world._editIndices];
    for (const view of views) for (const field of ['constructor', 'length', 'byteOffset', 'byteLength', 'buffer', Symbol.iterator]) Object.defineProperty(view, field, { configurable: true, get: getter });
    try { require(hash() === editBefore, 'Spoofed cache view metadata changed identity'); require(getters === 0, 'Cache evidence executed metadata hooks'); }
    finally { for (const view of views) for (const field of ['constructor', 'length', 'byteOffset', 'byteLength', 'buffer', Symbol.iterator]) delete view[field]; }
    const base = hash(), oldWall = world._edgeWallCache[0]; world._edgeWallCache[0] = { revision: 0, y: 72, wallX: 12, hazardKey: '', tileRevision: 0 };
    const wall = hash(); world._edgeWallCache[0].wallX = 11; require(hash() !== wall && wall !== base, 'Behavior-changing wall continuation was omitted'); world._edgeWallCache[0] = oldWall;
    const assisted = world._assistedColumn, prior = { ...assisted }; Object.assign(assisted, { valid: true, x: 36, y: 65, height: 8, revision: world.terrainRevision, value: 1 });
    const active = hash(); assisted.value = 2; require(hash() !== active, 'Behavior-changing active assist was omitted'); Object.assign(assisted, prior);
    return { failures, collisionGround: true, editGround: true, getters, compactionStable: true, heldPristineStable: true, wallContinuationDistinct: true, activeAssistDistinct: true,
      scope: 'Owned collision/edit binding refusal and actual source repair; wall and active-assist continuations remain authoritative, without claiming warm/cold wall-cache normalization.' };
  } finally { trial.dispose(); foreign.dispose(); }
}
