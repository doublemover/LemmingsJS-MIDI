import { expect } from 'chai';
import {
  ANALYTICS_EVENT_TYPES,
  analyticsStorageKeys,
  createAnalyticsService
} from '../js/app/analytics.js';

const createStorage = () => {
  const map = new Map();
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    }
  };
};

const createLocation = (search = '') => ({
  search,
  pathname: '/index.html',
  protocol: 'https:',
  hostname: 'example.com'
});

describe('analytics service', function () {
  it('defaults to disabled tracking until consent is granted', function () {
    const storage = createStorage();
    const analytics = createAnalyticsService({
      location: createLocation(''),
      localStorage: storage,
      profile: 'classic',
      surface: 'game',
      now: () => 100
    });

    expect(analytics.getStatus().enabled).to.equal(false);
    expect(analytics.track(ANALYTICS_EVENT_TYPES.VISITOR_PAGE_VIEW, {})).to.equal(null);
    expect(analytics.exportBuffer().events).to.have.lengthOf(0);
  });

  it('grants consent from query and records page-view events', function () {
    const storage = createStorage();
    const analytics = createAnalyticsService({
      location: createLocation('?analytics=1'),
      localStorage: storage,
      profile: 'classic',
      surface: 'game',
      now: () => 1234
    });

    const event = analytics.trackPageView({ embedMode: true });
    expect(event?.type).to.equal(ANALYTICS_EVENT_TYPES.VISITOR_PAGE_VIEW);
    expect(event?.data?.embedMode).to.equal(true);
    expect(analytics.getStatus().enabled).to.equal(true);
    expect(storage.getItem(analyticsStorageKeys.consent)).to.equal('granted');
  });

  it('keeps a fixed-size ring buffer', function () {
    const analytics = createAnalyticsService({
      location: createLocation('?analytics=1'),
      localStorage: createStorage(),
      profile: 'classic',
      surface: 'game',
      maxEvents: 2,
      now: () => 2000
    });

    analytics.track(ANALYTICS_EVENT_TYPES.GAMEPLAY_LEVEL_SELECT, {
      control: 'gameType',
      value: 1
    });
    analytics.track(ANALYTICS_EVENT_TYPES.GAMEPLAY_LEVEL_SELECT, {
      control: 'levelGroup',
      value: 2
    });
    analytics.track(ANALYTICS_EVENT_TYPES.GAMEPLAY_LEVEL_SELECT, {
      control: 'levelIndex',
      value: 3
    });

    const exported = analytics.exportBuffer();
    expect(exported.events).to.have.lengthOf(2);
    expect(exported.events[0].data.control).to.equal('levelGroup');
    expect(exported.events[1].data.control).to.equal('levelIndex');
  });

  it('hard-disables tracking even when consent query is provided', function () {
    const analytics = createAnalyticsService({
      hardDisabled: true,
      location: createLocation('?analytics=1'),
      localStorage: createStorage(),
      profile: 'classic',
      surface: 'game'
    });

    expect(analytics.getStatus().enabled).to.equal(false);
    expect(analytics.track(ANALYTICS_EVENT_TYPES.GAMEPLAY_MIDI_TOGGLE, { enabled: true })).to.equal(null);
  });

  it('supports explicit export/import for local-only telemetry workflows', function () {
    const source = createAnalyticsService({
      location: createLocation('?analytics=1'),
      localStorage: createStorage(),
      profile: 'classic',
      surface: 'game',
      now: () => 3000
    });
    source.track(ANALYTICS_EVENT_TYPES.GAMEPLAY_SAVED_LEVEL, { action: 'save' });
    source.track(ANALYTICS_EVENT_TYPES.GAMEPLAY_SAVED_LEVEL, { action: 'export' });
    const snapshot = source.exportBuffer();

    const target = createAnalyticsService({
      location: createLocation('?analytics=1'),
      localStorage: createStorage(),
      profile: 'classic',
      surface: 'game',
      now: () => 4000
    });
    target.track(ANALYTICS_EVENT_TYPES.GAMEPLAY_MIDI_TOGGLE, { enabled: true });

    const imported = target.importBuffer(snapshot, { replace: true });
    const exported = target.exportBuffer();
    expect(imported.imported).to.equal(2);
    expect(imported.total).to.equal(2);
    expect(exported.events.map(event => event.data.action)).to.deep.equal(['save', 'export']);
  });

  it('keeps managed beacon off by default and sends only when explicitly enabled', function () {
    const calls = [];
    const navigatorRef = {
      sendBeacon(url, body) {
        calls.push({ url, body });
        return true;
      }
    };
    const endpoint = 'https://analytics.example.com/collect';

    const defaultOff = createAnalyticsService({
      location: createLocation('?analytics=1'),
      navigator: navigatorRef,
      managedBeaconEndpoint: endpoint,
      localStorage: createStorage(),
      profile: 'classic',
      surface: 'game'
    });
    defaultOff.track(ANALYTICS_EVENT_TYPES.GAMEPLAY_MIDI_TOGGLE, { enabled: true });
    const firstFlush = defaultOff.flushManagedBeacon();
    expect(defaultOff.getStatus().managedBeacon.enabled).to.equal(false);
    expect(firstFlush.sent).to.equal(0);
    expect(calls).to.have.lengthOf(0);

    const enabled = createAnalyticsService({
      location: createLocation('?analytics=1&analyticsBeacon=1'),
      navigator: navigatorRef,
      managedBeaconEndpoint: endpoint,
      localStorage: createStorage(),
      profile: 'classic',
      surface: 'game',
      now: () => 5000
    });
    enabled.track(ANALYTICS_EVENT_TYPES.GAMEPLAY_MIDI_TOGGLE, { enabled: true });
    const secondFlush = enabled.flushManagedBeacon();
    expect(enabled.getStatus().managedBeacon.enabled).to.equal(true);
    expect(secondFlush.sent).to.equal(1);
    expect(calls).to.have.lengthOf(1);
    expect(calls[0].url).to.equal(endpoint);
    const payload = JSON.parse(calls[0].body);
    expect(payload.events).to.have.lengthOf(1);
    expect(payload.events[0].type).to.equal(ANALYTICS_EVENT_TYPES.GAMEPLAY_MIDI_TOGGLE);
  });
});
