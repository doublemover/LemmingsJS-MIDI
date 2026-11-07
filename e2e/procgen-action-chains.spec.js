import { expect, test } from '@playwright/test';

test('browser runtime completes a bounded four-stage physical route for an admitted ordinary crew', { tag: ['@boundary', '@workstation-physical-route'] }, async ({ page }) => {
  await page.goto('/procgen.html?e2e=1&seed=42&lanes=1');
  await page.waitForFunction(() => window.__PROCGEN_LANES__?.world?.gameResources);
  const result = await page.evaluate(async () => {
    const api = window.__PROCGEN_LANES__; api.pause();
    const [{ chainWorld }, { LemmingStateType: State }, { FileProvider }, { GameResources }] = await Promise.all([
      import('/test/support/procgen-chain-fixtures.js'), import('/js/lemmings/LemmingStateType.js'), import('/js/data/FileProvider.js'), import('/js/game/GameResources.js')
    ]);
    const provider = new FileProvider('/', { indexedDB: null, localStorage: null }), resources = new GameResources(provider, { path: 'lemmings' });
    let masks;
    try { masks = await resources.getMasks(); } finally { resources.dispose(); provider.dispose(); }
    const { world, actor } = chainWorld(masks, 'quad'); world.admissionPaused = true;
    try {
      const crew = [actor], events = [];
      for (const x of [45, 40]) {
        const member = world._spawn(0, false); Object.assign(member, { x, y: 72, scout: false }); member.setAction(world.actions[State.WALKING]); crew.push(member);
      }
      for (const member of crew) world.lanePolicy.projects.observe(member);
      world.soundEvents.onEvent.on(event => { if (event.type === 'procgen-route-complete') events.push(event); });
      world.assists = true; world.step();
      const project = world.lanePolicy.projects.lanes[0].projects[0];
      let maxWork = 0, connectedWithoutCompletion = false;
      while (world.tickIndex < 750 && project?.phase !== 'complete' && project?.phase !== 'failed') {
        world.step(); maxWork = Math.max(maxWork, world.hazardPlanner.admission.lanes[0].probes);
        connectedWithoutCompletion ||= project.phase === 'connected' && events.length === 0;
      }
      return { phase: project?.phase, failure: project?.failure, members: [...project.members.values()], goal: [project.goalX, project.goalY], kinds: project?.chain.stages.map(stage => stage.kind), maxWork, connectedWithoutCompletion,
        events: events.map(event => ({ admittedCrew: event.admittedCrew, crossings: event.ordinaryCrossings, recovered: event.recoveredBlockers })),
        crew: crew.map(member => ({ x: member.x, y: member.y, dead: !!(member.failureReason || member.terminalReason), walking: member.action === world.actions[State.WALKING], ability: !!(member.canClimb || member.hasParachute) })) };
    } finally { world.dispose(); }
  });
  expect(result.phase, JSON.stringify(result)).toBe('complete');
  expect(result.kinds).toEqual(['builders', 'bashers', 'builders', 'bashers']);
  expect(result.maxWork).toBeLessThanOrEqual(1024); expect(result.connectedWithoutCompletion).toBe(true);
  expect(result.events).toEqual([{ admittedCrew: 3, crossings: 2, recovered: 2 }]);
  for (const actor of result.crew) expect(actor).toMatchObject({ dead: false, walking: true, ability: false });
});
