import { expect } from 'chai';
import { observePrivateClockAttempt } from '../e2e/helpers/privateClockAttempt.js';

describe('native clock attempt attachment ownership', () => {
  it('retains a complete successful observation before a later caller assertion can fail', async () => {
    const result = { produced: { onsets: 8 }, actual: { snapshot: { nodes: [{ expectedFrame: 10, submittedFrame: 11 }] } } }, attachments = [];
    const page = { async evaluate(_run, input) { expect(input).to.deep.equal({ action: 'stall', value: 50 }); return result; } };
    let observed; try {
      const attempt = await observePrivateClockAttempt(page, { async attach(name, value) { attachments.push({ name, value }); } }, 'stall', 50);
      expect(attempt).to.equal(result); expect(attachments).to.have.length(1); throw new Error('Controlled original-target assertion');
    } catch (error) { observed = error; }
    expect(observed.message).to.equal('Controlled original-target assertion'); expect(attachments[0].name).to.equal('native-clock-preassert-attempt.json');
    expect(JSON.parse(attachments[0].value.body)).to.deep.equal(result);
  });
  it('attaches the original producer failure and separate snapshot failure before propagating the producer message', async () => {
    const result = { produced: null, failure: { stage: 'source-production', message: 'Original source admission refused' }, snapshot: null, snapshotError: 'Observer unavailable' }, attachments = [];
    let observed; try { await observePrivateClockAttempt({ async evaluate() { return result; } }, { async attach(name, value) { attachments.push({ name, value }); } }, 'cancel'); }
    catch (error) { observed = error; }
    expect(observed.message).to.equal(result.failure.message); expect(attachments).to.have.length(1); expect(attachments[0].name).to.equal('native-clock-failed-attempt.json');
    expect(JSON.parse(attachments[0].value.body).snapshotError).to.equal('Observer unavailable');
  });
});
