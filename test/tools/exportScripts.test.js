import { expect } from 'chai';
import fs from 'fs';
import path from 'path';

const scripts = [
  'exportAllPacks.js',
  'exportAllSprites.js',
  'exportGroundImages.js',
  'exportLemmingsSprites.js',
  'exportPanelSprite.js',
  'renderCursorSizes.js',
  'scanGreenPanel.js',
];

describe('export scripts default path', function () {
  for (const file of scripts) {
    it(`${file} exports under ./exports`, function () {
      const content = fs.readFileSync(path.join('tools', file), 'utf8');
      expect(content).to.match(/['"]exports['"]/);
      expect(/path\.join\(['"]exports['"]/.test(content) || /const\s+BASE\s*=\s*['"]exports['"]/.test(content)).to.be.true;
    });
  }
});
