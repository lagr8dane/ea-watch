// lib/actions/shortcuts.js
// Builds Siri Shortcuts invocation URLs from action_config objects.
// Called by chain-engine.js for steps with action_type === 'shortcut'.
//
// How Shortcuts integration works:
//   1. User pre-builds a named Shortcut on their iPhone (once, in the Shortcuts app).
//   2. In the chain builder, they reference the Shortcut by its exact name.
//   3. The EA fires the Shortcut via the shortcuts:// URL scheme.
//   4. iOS executes the Shortcut natively — full HealthKit, HomeKit, DND access.
//
// action_config shape:
//   {
//     name: string,       // exact Shortcut name as it appears in the Shortcuts app
//     input?: string,     // optional text input passed to the Shortcut
//     message?: string,   // what the EA says when firing this step (optional)
//   }
//
// Shortcut names are case-sensitive and must match exactly.
// Spaces in names are encoded as %20.
//
// Common Shortcuts to pre-build (documented here for the owner's reference):
//   "Start Hike"         — starts a Hiking workout in Health
//   "Enable DND"         — enables Do Not Disturb Focus
//   "Disable DND"        — disables Do Not Disturb Focus
//   "Share Location"     — sends current location to a trusted contact via iMessage
//   "Stop Workout"       — ends the active Health workout
//   "HomeKit Scene"      — activates a named HomeKit scene (parameterised via input)
//   "Morning Lights"     — example: sets specific HomeKit lights
//
// x-callback-url scheme:
//   shortcuts://run-shortcut?name=[name]&input=[input]
//   shortcuts://x-callback-url/run-shortcut?name=[name]&input=[input]&x-success=[url]
//
// We use the simple form (no x-callback) — the EA does not wait for Shortcut completion.
// Fire-and-forget is correct here: OS executes the Shortcut, EA moves to the next step.

export function buildShortcut(config) {
  const { name, input } = config;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error('shortcut action_config requires a non-empty name field');
  }

  const params = new URLSearchParams();
  params.set('name', name.trim());

  if (input !== undefined && input !== null && input !== '') {
    params.set('input', String(input));
  }

  return `shortcuts://run-shortcut?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Shortcut registry helpers
// Used by the chain builder UI to validate Shortcut names before saving.
// The registry is advisory only — the EA does not validate at execution time
// (Shortcuts app handles errors if the name doesn't exist).
// ---------------------------------------------------------------------------

/**
 * Returns the list of well-known Shortcuts for the owner's reference.
 * This is surfaced in the chain builder as suggested names.
 * The owner is free to use any name — this list is not exhaustive.
 */
export function suggestedShortcuts() {
  return [
    {
      name: 'Start Hike',
      description: 'Starts a Hiking workout in Apple Health',
      category: 'health',
    },
    {
      name: 'Stop Workout',
      description: 'Ends the active Apple Health workout',
      category: 'health',
    },
    {
      name: 'Enable DND',
      description: 'Enables Do Not Disturb Focus mode',
      category: 'focus',
    },
    {
      name: 'Disable DND',
      description: 'Disables Do Not Disturb Focus mode',
      category: 'focus',
    },
    {
      name: 'Share Location',
      description: 'Sends current location to your trusted contact via iMessage',
      category: 'communication',
    },
    {
      name: 'HomeKit Scene',
      description: 'Activates a HomeKit scene (pass scene name as input)',
      category: 'home',
    },
  ];
}
