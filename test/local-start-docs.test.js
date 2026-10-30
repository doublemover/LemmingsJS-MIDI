import { expect } from 'chai';
import { readFile } from 'node:fs/promises';

describe('ordinary local startup documentation', () => {
  it('matches documented origins and Node policy to the actual package scripts', async () => {
    const root = new URL('../', import.meta.url);
    const [packageText, readme, usage] = await Promise.all(['package.json', 'README.md', 'docs/usage.md'].map(file => readFile(new URL(file, root), 'utf8')));
    const manifest = JSON.parse(packageText), command = manifest.scripts.start;
    expect(command).to.include('-a 127.0.0.1').and.include('-p 8080');
    expect(command).not.to.match(/(?:^|\s)(?:-S|--ssl)(?:\s|$)/);
    for (const text of [readme, usage]) {
      expect(text).to.include('http://127.0.0.1:8080').and.include('http://127.0.0.1:8080/editor.html');
      expect(text).to.include(manifest.engines.node).and.include('npm start').and.include('npm run start-https');
      expect(text).to.include('certs/localhost.pem').and.include('certs/localhost-key.pem');
    }
    expect(manifest.scripts['start-https']).to.include(' -S ').and.include(' -C certs/localhost.pem').and.include(' -K certs/localhost-key.pem');
    expect(readme).not.to.include('C:\\Users\\sneak');
  });
});
