import { expect } from 'chai';
import {
  buildToolCatalog,
  createLegacyToolAliases,
  parseBooleanEnv,
  resolveToolCandidates
} from '../mcp/toolRouting.js';

describe('mcp tool routing helpers', function () {
  it('parses boolean env values with explicit fallback', function () {
    expect(parseBooleanEnv('true', false)).to.equal(true);
    expect(parseBooleanEnv('0', true)).to.equal(false);
    expect(parseBooleanEnv('unknown', true)).to.equal(true);
  });

  it('builds empty aliases when disabled', function () {
    expect(createLegacyToolAliases(false)).to.deep.equal({});
  });

  it('maps legacy underscore and dotted aliases', function () {
    const aliases = createLegacyToolAliases(true);
    expect(aliases.editor_mutate).to.equal('editor_apply');
    expect(aliases['editor.mutate']).to.equal('editor_apply');
    expect(aliases.editor_objects_list).to.equal('objects_list');
    expect(aliases['editor.objects.list']).to.equal('objects_list');
  });

  it('resolves candidates from aliases and dotted fallback', function () {
    const aliases = createLegacyToolAliases(true);
    const resolved = resolveToolCandidates('editor.mutate', {
      legacyToolAliases: aliases,
      dottedFallbackEnabled: true,
      toToolName: (name) => name.replace(/\./g, '_')
    });

    expect(resolved.requestedName).to.equal('editor.mutate');
    expect(resolved.candidates).to.deep.equal(['editor_apply']);
  });

  it('includes normalized fallback candidate when no direct alias exists', function () {
    const resolved = resolveToolCandidates('game.state.get', {
      legacyToolAliases: {},
      dottedFallbackEnabled: true,
      toToolName: (name) => name.replace(/\./g, '_')
    });

    expect(resolved.candidates).to.deep.equal([
      'game.state.get',
      'game_state_get'
    ]);
  });

  it('skips dotted fallback candidates when disabled', function () {
    const resolved = resolveToolCandidates('editor.objects.list', {
      legacyToolAliases: {},
      dottedFallbackEnabled: false,
      toToolName: (name) => name.replace(/\./g, '_')
    });

    expect(resolved.candidates).to.deep.equal(['editor.objects.list']);
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

  it('deduplicates alias and dotted fallback candidates when both resolve to the same tool', function () {
    const resolved = resolveToolCandidates('editor.mutate', {
      legacyToolAliases: {
        'editor.mutate': 'editor_apply',
        editor_mutate: 'editor_apply'
      },
      dottedFallbackEnabled: true,
      toToolName: (name) => name.replace(/\./g, '_')
    });

    expect(resolved.candidates).to.deep.equal(['editor_apply']);
  });
});
