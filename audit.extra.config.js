import config from './audit.playwright.config.js';
export default { ...config, webServer: undefined,
  reporter: [['list'], ['json', { outputFile: 'evidence/editor-extra.json' }]],
  use: { ...config.use, baseURL: 'http://127.0.0.1:8096' } };
