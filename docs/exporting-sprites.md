# Play Locally, Export & Patch Sprites

- Install [Node.js](https://nodejs.org)
- Clone: `git clone https://github.com/doublemover/LemmingsJS-MIDI`
- Terminal:
  - `npm install`
  - `npm start`
  - `npm run export-all-packs` *(optional)* – exports sprite folders for all level packs under `exports/`
    - `zip -r export_lemmings.zip exports/export_lemmings`
    - `tar -czf export_lemmings.tgz exports/export_lemmings`
    - `rar a export_lemmings.rar exports/export_lemmings`
    - `npm run clean-exports` *(remove `export_*` folders)*
- Other useful scripts:
  - `npm run export-panel-sprite` – export the skill panel sprite as `exports/panel_export`
  - `npm run export-lemmings-sprites` – export all lemming animations to `exports/<pack>_sprites`
  - `npm run export-ground-images` – export ground and object images from a single ground set
  - `npm run export-all-sprites` – export the panel, lemmings and ground sprites for one level pack
  - `npm run list-sprites` – list sprite names with sizes and frame counts
  - `npm run patch-sprites` – verify a directory of edited sprites (patching not yet implemented)

All exported assets now reside under the `exports/` directory.

### NodeFileProvider

The Node scripts in the `tools` directory use `NodeFileProvider` to read level packs. This provider can load files directly from folders or from archives such as `.zip`, `.tar`, `.tar.gz`, `.tgz`, and `.rar`, so you can keep level packs packed while running scripts with Node.

### Progressive Web App

This repo ships with [site.webmanifest](../site.webmanifest) so it can be installed as a **Progressive Web App (PWA)**. Installing adds the game to your device's app list and launches it fullscreen in landscape mode. Touch input still needs polish, so the mobile experience may be rough.
