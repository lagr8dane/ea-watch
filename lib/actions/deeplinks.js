// lib/actions/deeplinks.js
// Builds iOS/Android deeplink URLs from action_config objects.
// Called by chain-engine.js for steps with action_type === 'deeplink'.
//
// action_config shape varies by kind — see each builder below.
// All builders throw on missing required fields so the engine can handle the error.
//
// Supported kinds:
//   maps        — open Maps with a destination
//   call        — initiate a phone call
//   facetime    — FaceTime audio or video call
//   sms         — open Messages to a contact (optionally pre-filled)
//   spotify     — open a Spotify URI (track, playlist, album, artist)
//   timer       — set a timer via Clock app (iOS only)
//   reminder    — create a reminder (iOS only, opens Reminders)
//   dnd         — open Focus settings (user enables DND manually — no API for silent enable)
//   url         — open any arbitrary URL (escape hatch)

export function buildDeeplink(config) {
  const { kind } = config;
  if (!kind) throw new Error('Deeplink action_config missing required field: kind');

  switch (kind) {
    case 'maps':     return buildMaps(config);
    case 'call':     return buildCall(config);
    case 'facetime': return buildFaceTime(config);
    case 'sms':      return buildSms(config);
    case 'spotify':  return buildSpotify(config);
    case 'timer':    return buildTimer(config);
    case 'reminder': return buildReminder(config);
    case 'dnd':      return buildDnd(config);
    case 'url':      return buildUrl(config);
    default:
      throw new Error(`Unknown deeplink kind: ${kind}`);
  }
}

// ---------------------------------------------------------------------------
// Maps
// config: { kind: 'maps', destination: string, mode?: 'drive'|'walk'|'transit' }
// ---------------------------------------------------------------------------
function buildMaps({ destination, mode }) {
  if (!destination) throw new Error('maps deeplink requires destination');
  const encoded = encodeURIComponent(destination);
  // Apple Maps
  const base = `maps://?q=${encoded}`;
  if (mode === 'drive')   return `${base}&dirflg=d`;
  if (mode === 'walk')    return `${base}&dirflg=w`;
  if (mode === 'transit') return `${base}&dirflg=r`;
  return base;
}

// ---------------------------------------------------------------------------
// Phone call
// config: { kind: 'call', number: string }
// ---------------------------------------------------------------------------
function buildCall({ number }) {
  if (!number) throw new Error('call deeplink requires number');
  // Strip spaces and dashes for cleanliness; keep + for international
  const clean = number.replace(/[\s\-()]/g, '');
  return `tel:${clean}`;
}

// ---------------------------------------------------------------------------
// FaceTime
// config: { kind: 'facetime', contact: string, video?: bool }
// contact can be a phone number or email
// ---------------------------------------------------------------------------
function buildFaceTime({ contact, video }) {
  if (!contact) throw new Error('facetime deeplink requires contact');
  const encoded = encodeURIComponent(contact);
  return video === false
    ? `facetime-audio://${encoded}`
    : `facetime://${encoded}`;
}

// ---------------------------------------------------------------------------
// SMS / iMessage
// config: { kind: 'sms', number: string, body?: string }
// ---------------------------------------------------------------------------
function buildSms({ number, body }) {
  if (!number) throw new Error('sms deeplink requires number');
  const clean = number.replace(/[\s\-()]/g, '');
  if (body) {
    const encoded = encodeURIComponent(body);
    return `sms:${clean}&body=${encoded}`;
  }
  return `sms:${clean}`;
}

// ---------------------------------------------------------------------------
// Spotify
// config: { kind: 'spotify', uri: string }
// uri examples:
//   spotify:playlist:37i9dQZF1DXcBWIGoYBM5M
//   spotify:track:4uLU6hMCjMI75M1A2tKUQC
//   spotify:artist:0TnOYISbd1XYRBk9myaseg
// ---------------------------------------------------------------------------
function buildSpotify({ uri }) {
  if (!uri) throw new Error('spotify deeplink requires uri');
  // Accept either spotify:... URI or https://open.spotify.com/... URL
  if (uri.startsWith('spotify:')) return uri;
  if (uri.startsWith('https://open.spotify.com/')) return uri;
  throw new Error(`Invalid Spotify URI: ${uri}`);
}

// ---------------------------------------------------------------------------
// Timer (iOS Clock app)
// config: { kind: 'timer', minutes: number, label?: string }
// Note: iOS timer deeplink opens Clock but does not auto-start.
// User taps Start. This is an OS limitation.
// ---------------------------------------------------------------------------
function buildTimer({ minutes, label }) {
  if (!minutes) throw new Error('timer deeplink requires minutes');
  const seconds = Math.round(minutes * 60);
  const base = `clock-timer://`;
  // Clock app deeplink — sets duration, opens timer screen
  // label param is not supported by iOS Clock; included for reference only
  return `${base}?startTimer=1&seconds=${seconds}`;
}

// ---------------------------------------------------------------------------
// Reminder (iOS Reminders app)
// config: { kind: 'reminder', title: string, notes?: string }
// Opens Reminders with a new item pre-filled. User confirms.
// ---------------------------------------------------------------------------
function buildReminder({ title, notes }) {
  if (!title) throw new Error('reminder deeplink requires title');
  const params = new URLSearchParams({ title });
  if (notes) params.set('notes', notes);
  return `x-apple-reminderkit://REMCDReminder/?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// DND / Focus
// config: { kind: 'dnd' }
// iOS has no silent deeplink to enable DND. This opens Focus settings.
// Silent DND enable requires a Siri Shortcut — see shortcuts.js.
// ---------------------------------------------------------------------------
function buildDnd() {
  // Opens iOS Settings > Focus
  return `App-Prefs:root=DO_NOT_DISTURB`;
}

// ---------------------------------------------------------------------------
// Arbitrary URL (escape hatch)
// config: { kind: 'url', url: string }
// ---------------------------------------------------------------------------
function buildUrl({ url }) {
  if (!url) throw new Error('url deeplink requires url');
  return url;
}
