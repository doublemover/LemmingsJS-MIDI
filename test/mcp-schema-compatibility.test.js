import { expect } from 'chai';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';
import { ObjectsPlaceSchema, ObjectsUpdateSchema } from '../mcp/schemas.js';

describe('MCP editor schema compatibility', () => {
  it('preserves arbitrary object properties and update values through validation', () => {
    const placed = { sessionId: 'editor', objects: [{ kind: 'terrain', props: { x: 12, hidden: false, extra: { tag: 'stone' } } }] };
    const updated = { sessionId: 'editor', updates: [{ ref: { index: 0 }, set: { x: 20, extra: ['a', 1] } }] };
    expect(ObjectsPlaceSchema.parse(placed)).to.deep.equal(placed);
    expect(ObjectsUpdateSchema.parse(updated)).to.deep.equal(updated);
    expect(ObjectsUpdateSchema.safeParse({ sessionId: 'editor', updates: [{ ref: { index: 0 }, set: {} }] }).success).to.equal(false);
  });

  it('publishes record fields through the SDK JSON schema adapter', () => {
    for (const [schema, key, field] of [[ObjectsPlaceSchema, 'objects', 'props'], [ObjectsUpdateSchema, 'updates', 'set']]) {
      const wire = toJsonSchemaCompat(schema);
      const record = wire.properties[key].items.properties[field];
      expect(record.type).to.equal('object');
      expect(record.additionalProperties).not.to.equal(false);
    }
  });
});
