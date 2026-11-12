/** Named constants for the Sentence Reel behaviour. No magic numbers elsewhere. */

/** Segments used when the media has no usable caption cues (time mode). */
export const FALLBACK_SEGMENT_COUNT = 28;

/** Fewer sentences than this cannot make a reel; the reel then moves by time. */
export const MIN_TEXT_SENTENCES = 4;

/** Most notches the reel draws. More sentences are grouped (A11Y-SPEC section 10, task item 9). */
export const NOTCH_CAP = 40;

/** Notch numbers are printed only up to this many notches; more would not fit. */
export const NOTCH_NUMBERS_MAX = 20;

/** Above that, every this-many'th notch carries its number. */
export const NOTCH_NUMBER_STEP = 5;
/** The artist's baked ring is drawn for exactly this many notches (22.5 degree slots); any other count keeps the drawn ring. */
export const BAKED_RING_NOTCHES = 16;

/** Sentence-ending punctuation, then optional closing quotes or brackets, then whitespace or end. */
export const SENTENCE_BREAK = /(?<=[.!?…]["'”’)\]]*)\s+/;
export const SENTENCE_END = /[.!?…]["'”’)\]]*$/;

/** Words that end in a full stop without ending the sentence (compared lowercase). */
export const ABBREVIATIONS: readonly string[] = ['mr.', 'mrs.', 'ms.', 'dr.', 'prof.', 'st.', 'vs.', 'e.g.', 'i.e.', 'etc.', 'no.'];

/** A sentence shorter than this (seconds) cannot be told apart from its neighbour. */
export const MIN_SENTENCE_SECONDS = 0.05;

/** Seconds of slack when deciding that playback has reached a sentence end. */
export const BOUNDARY_EPSILON = 0.02;

/**
 * Wait stops when the playhead reaches the cue end, within this slack (seconds). It never stops early
 * by more than this, so the end of the speech is not cut; the playhead is then put on the exact end.
 */
export const WAIT_END_TOLERANCE = 0.001;
/** Shortest timer the Wait guard schedules (ms), so a stalled playhead never spins. */
export const WAIT_MIN_TIMER_MS = 8;


/** Volume has five levels plus off. */
export const VOLUME_LEVELS = 5;

/** Keyboard steps. */
export const SEEK_STEP_SECONDS = 5;
/** J and L, and a double tap on the left or right third of the picture (the YouTube and Netflix step). */
export const SKIP_SECONDS = 10;
/** The one speed list: the Video.js playback rates, the dial's five detents, and what Shift+< and Shift+> step through. */
export const SPEEDS: readonly number[] = [0.5, 1, 1.25, 1.5, 2];
/** How long a speed or skip note stays in the dot window before the sentence comes back (ms). */
export const FEEDBACK_MS = 1400;
/** A second tap on the picture within this (ms) is a double tap; a single tap waits this long. Kept under 250. */
export const DOUBLE_TAP_MS = 220;
/** In full screen, the controls hide after this long without input while playing (ms). */
export const IDLE_HIDE_MS = 2000;
export const FADER_PAGE_SECONDS = 30;
export const REEL_PAGE_SENTENCES = 5;

/** Again restarts the current sentence; under this many seconds into it, it goes to the previous one. */
export const AGAIN_PREVIOUS_SECONDS = 1;

/** Caption discovery. */
export const CUE_POLL_MS = 100;
export const CUE_WAIT_MS = 8000;
/** With no caption track at all, wait this long for one to appear before using time mode. */
export const NO_TRACK_GRACE_MS = 2000;
/**
 * Cue count must hold still this long before the cue list counts as final. Until then the reel shows
 * and announces no sentence total (measured on a Mux HLS stream: batches of 10, 46 and 68 cues arrive
 * more than half a second apart).
 */
export const CUE_SETTLE_MS = 1000;
/**
 * When is a cue list complete, so that its total may be shown? (1) its last cue ends within
 * COMPLETE_TOLERANCE_SECONDS of the end of the media; or (2) it has been still for CUE_SETTLE_MS, its last
 * cue ends a sentence, and it ends within COVER_SLACK_SHARE of the media (at least COVER_SLACK_MIN_SECONDS);
 * or (3) nothing new has come for CUE_LATE_WINDOW_MS. Measured: the real Mux track stops 8 s short, in the
 * middle of a sentence, and a last cue can arrive seconds later, so (2) does not fire for it.
 */
export const COMPLETE_TOLERANCE_SECONDS = 2;
export const COVER_SLACK_SHARE = 0.1;
export const COVER_SLACK_MIN_SECONDS = 5;
/** After giving up, keep watching slowly for late captions for this long. */
export const CUE_LATE_WINDOW_MS = 60000;
export const CUE_LATE_POLL_MS = 1000;

/** Wait in a tab where timers are throttled: the worst delay of a media timeupdate event (seconds). */
export const WAIT_THROTTLED_LATENESS = 0.25;
/** Extra seconds of margin on that, so a timeupdate that lands exactly on the edge still mutes in time. */
export const WAIT_DUCK_MARGIN = 0.05;

/** Full screen: how long to wait for the browser to answer a request before treating it as refused (ms). */
export const FULLSCREEN_TIMEOUT_MS = 3000;
/** After full screen ends, wait this long (ms) for the browser to settle its own focus, then fix it. */
export const FOCUS_RETURN_MS = 50;

/** Status region. */
export const ANNOUNCE_DEBOUNCE_MS = 250;
export const VALUETEXT_MAX_CHARS = 160;

export const SECONDS_PER_MINUTE = 60;
export const SECONDS_PER_HOUR = 3600;

/** A play request that has not become playing is retried after this long (ms), then surfaced this much later. */
export const PLAY_RETRY_MS = 8000;
/** "Loading" is announced only if the wait lasts this long (ms), so an ordinary quick start says nothing. */
export const LOADING_ANNOUNCE_MS = 1000;
export const PLAY_GIVE_UP_MS = 8000;

/** HTMLMediaElement.readyState: at least the frame at the playhead is available, so it can play. */
export const HAVE_CURRENT_DATA = 2;

export const MESSAGES = {
  fullscreenFailed: 'Full screen is not available here.',
  playFailed: 'Playback could not start. Press Play to try again.',
  mediaError: 'The media could not be loaded, either because the server or network failed or because the format is not supported.',
  playSlow: 'Playback is taking too long. Press Play to try again.',
} as const;
