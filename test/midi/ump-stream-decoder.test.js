import { expect } from 'chai';
import { createUmpStreamDecoder } from '../../js/midi/protocol/UmpStreamDecoder.js';
import { createUmpPayloadCollector } from '../../js/midi/protocol/UmpPayloadCollector.js';
import { decodeUmpPacket, umpWordsToBytes } from '../../js/midi/protocol/UmpPacketCodec.js';

describe('bounded split UMP ingress and payload ownership', () => {
  it('reassembles every wire-byte split with at most fifteen retained bytes', () => {
    const words = [0x40913c00, 0x80000000, 0xf0200000, 0, 0, 0, 0x00100001], bytes = umpWordsToBytes(words);
    for (let split = 0; split <= bytes.length; split++) {
      const decoder = createUmpStreamDecoder(), packets = [...decoder.pushBytes(bytes.subarray(0, split))]; expect(decoder.diagnostics().retainedBytes).to.be.at.most(15);
      packets.push(...decoder.pushBytes(bytes.subarray(split))); expect(packets.flatMap(packet => packet.words)).to.deep.equal(words); expect(decoder.end().packets).to.equal(3);
    }
  });
  it('poisons failed streams and bounds retained unknown diagnostics', () => {
    const decoder = createUmpStreamDecoder({ maximumDiagnostics: 1 }); decoder.pushWords([0x60000000, 0x70000000]); expect(decoder.diagnostics().omittedUnknown).to.equal(1);
    decoder.pushWords([0x40913c00]); expect(() => decoder.end()).to.throw('inside a packet'); expect(() => decoder.pushWords([0])).to.throw('Reset');
    decoder.reset(); expect(decoder.pushWords([0])).to.have.length(1);
  });
  it('isolates SysEx streams, rejects orphan continuations and expires incomplete state', () => {
    let at = 0; const collector = createUmpPayloadCollector({ now: () => at, timeoutMs: 10 });
    const start = decodeUmpPacket([0x30130102, 0x03000000]), end = decodeUmpPacket([0x30310400, 0]);
    expect(collector.accept(start).status).to.equal('partial'); const complete = collector.accept(end); expect([...complete.payload]).to.deep.equal([1, 2, 3, 4]); expect(collector.diagnostics().retainedBytes).to.equal(0);
    expect(() => collector.accept(end)).to.throw('Unexpected'); collector.accept(start); at = 11; expect(() => collector.accept(end)).to.throw('Unexpected'); expect(collector.diagnostics().expired).to.equal(1);
    expect(() => collector.accept({ ...start, words: [0x30178000, 0] })).to.throw();
  });
  it('refuses capacity before retaining an oversized multipart message', () => {
    const collector = createUmpPayloadCollector({ maximumMessageBytes: 3 }); collector.accept(decodeUmpPacket([0x30130102, 0x03000000]));
    expect(() => collector.accept(decodeUmpPacket([0x30310400, 0]))).to.throw('capacity'); expect(collector.diagnostics().retainedBytes).to.equal(0);
  });
});
