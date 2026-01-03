const STATS_PIXEL_URL = /https:\/\/sneakyness\.com\/stats\/lemmings-MIDI\/?/;

export async function installExternalAssetStubs(page) {
  const handler = (route) => route.fulfill({ status: 204 });
  await page.context().route(STATS_PIXEL_URL, handler);
}
