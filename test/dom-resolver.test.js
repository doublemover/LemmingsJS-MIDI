import { expect } from 'chai';
import {
  detectEmbedMode,
  resolveRequiredElements
} from '../js/app/domResolver.js';

describe('domResolver', function () {
  it('detects embed mode from query and dataset flags', function () {
    const queryMode = detectEmbedMode({
      windowRef: { location: { search: '?embed=1' } },
      documentRef: null
    });
    expect(queryMode).to.equal(true);

    const datasetMode = detectEmbedMode({
      windowRef: { location: { search: '' } },
      documentRef: { body: { dataset: { embedMode: 'true' } } }
    });
    expect(datasetMode).to.equal(true);

    const defaultMode = detectEmbedMode({
      windowRef: { location: { search: '' } },
      documentRef: { body: { dataset: {} }, documentElement: { dataset: {} } }
    });
    expect(defaultMode).to.equal(false);
  });

  it('throws explicit DomResolutionError for missing required ids', function () {
    const doc = {
      getElementById() {
        return null;
      }
    };
    let thrown = null;
    try {
      resolveRequiredElements(doc, ['gameCanvas', 'levelIndexSelect'], {
        context: 'boot',
        embedMode: true
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).to.not.equal(null);
    expect(thrown.name).to.equal('DomResolutionError');
    expect(thrown.embedMode).to.equal(true);
    expect(thrown.missingIds).to.deep.equal(['gameCanvas', 'levelIndexSelect']);
  });
});
