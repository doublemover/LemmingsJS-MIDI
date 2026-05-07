import { expect } from 'chai';
import {
  buildToolCatalog,
  resolveToolName
} from '../mcp/toolRouting.js';

describe('mcp tool routing helpers', function () {
  it('trims canonical tool names directly', function () {
    expect(resolveToolName('  editor_apply  ')).to.equal('editor_apply');
    expect(resolveToolName(0)).to.equal('0');
    expect(resolveToolName(null)).to.equal('');
  });

  it('builds route catalog for all tools while filtering list definitions by active surfaces', function () {
    const gameHandler = () => ({ ok: true });
    const editorHandler = () => ({ ok: true });
    const registry = {
      specs: [
        { name: 'game.state.get', description: 'game', schema: { type: 'object' } },
        { name: 'editor.apply', description: 'editor', schema: { type: 'object' } }
      ],
      handlersBySurface: new Map([
        ['game', new Map([['game.state.get', gameHandler]])],
        ['editor', new Map([['editor.apply', editorHandler]])]
      ]),
      toolSurfaceByName: new Map([
        ['game.state.get', 'game'],
        ['editor.apply', 'editor']
      ])
    };

    const { toolDefs, toolRoutes } = buildToolCatalog(registry, {
      activeSurfaces: new Set(['game']),
      toToolName: (name) => name.replace(/\./g, '_'),
      toJsonSchemaCompat: (schema) => ({ wrapped: schema })
    });

    expect(toolDefs).to.deep.equal([
      {
        name: 'game_state_get',
        description: 'game',
        inputSchema: { wrapped: { type: 'object' } }
      }
    ]);
    expect(Array.from(toolRoutes.keys()).sort()).to.deep.equal([
      'editor_apply',
      'game_state_get'
    ]);
    expect(toolRoutes.get('game_state_get')?.handler).to.equal(gameHandler);
    expect(toolRoutes.get('editor_apply')?.handler).to.equal(editorHandler);
    expect(toolRoutes.get('editor_apply')?.surface).to.equal('editor');
  });

  it('throws when two canonical tool names collide after normalization', function () {
    const handler = () => ({ ok: true });
    const registry = {
      specs: [
        { name: 'alpha.beta', description: 'first', schema: {} },
        { name: 'alpha_beta', description: 'second', schema: {} }
      ],
      handlersBySurface: new Map([
        ['game', new Map([
          ['alpha.beta', handler],
          ['alpha_beta', handler]
        ])]
      ]),
      toolSurfaceByName: new Map([
        ['alpha.beta', 'game'],
        ['alpha_beta', 'game']
      ])
    };

    expect(() => buildToolCatalog(registry, {
      toToolName: (name) => name.replace(/\./g, '_')
    })).to.throw('Tool name collision');
  });

});
