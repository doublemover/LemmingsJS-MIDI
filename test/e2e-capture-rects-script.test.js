import { expect } from 'chai';
import {
  npmConfigArgsFromEnv,
  parseCliArgs
} from '../scripts/e2e-capture-rects.js';

describe('scripts/e2e-capture-rects', function() {
  it('accepts npm run forwarded config values for capture filters', function() {
    const env = {
      npm_config_base_url: 'https://localhost:9090',
      npm_config_out_dir: 'temp/e2e-captures/focused',
      npm_config_viewport: 'tablet',
      npm_config_target: 'midi-output-status,midi-inspector',
      npm_config_json: 'true'
    };

    expect(npmConfigArgsFromEnv(env)).to.deep.equal([
      '--base-url=https://localhost:9090',
      '--out-dir=temp/e2e-captures/focused',
      '--viewport=tablet',
      '--target=midi-output-status,midi-inspector',
      '--json'
    ]);

    const parsed = parseCliArgs([], env);
    expect(parsed.baseUrl).to.equal('https://localhost:9090');
    expect(parsed.outDir).to.equal('temp/e2e-captures/focused');
    expect(parsed.viewport).to.equal('tablet');
    expect(parsed.targets).to.deep.equal(['midi-output-status', 'midi-inspector']);
    expect(parsed.json).to.equal(true);
  });

  it('lets explicit capture CLI options override npm config values', function() {
    const parsed = parseCliArgs([
      '--viewport=mobile',
      '--target=midi-source-browser',
      '--json'
    ], {
      npm_config_viewport: 'tablet',
      npm_config_target: 'midi-output-status'
    });

    expect(parsed.viewport).to.equal('mobile');
    expect(parsed.targets).to.deep.equal(['midi-output-status', 'midi-source-browser']);
    expect(parsed.json).to.equal(true);
  });
});
