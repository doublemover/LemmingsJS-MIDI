const STATS_PIXEL_URL = 'https://sneakyness.com/stats/lemmings-MIDI';

export async function installExternalAssetStubs(page) {
  await page.route(STATS_PIXEL_URL, (route) => {
    return route.fulfill({ status: 204 });
  });
}
