/**
 * Voice for Ask InnPilot (Phase 14) — the mic and the speaker, and nothing else.
 *
 * The brief's chain is mic -> STT -> agent -> tools -> response -> TTS. Only
 * the first and last links are new: everything between them already exists
 * and is unchanged, because a spoken question becomes an ordinary string
 * before it reaches `askInnPilot`, and a spoken answer is the reply the
 * server already returned. That is what "the agent stays input-source
 * agnostic" means in practice — there is no voice path through the agent to
 * diverge from the text one, and no second implementation of anything.
 *
 * ## Why the browser, and what that costs
 *
 * Speech recognition and synthesis here are the browser's own Web Speech
 * API. No dependency, no audio upload to our gateway, no new server route,
 * no new secret — the whole of V1's voice scope is this file plus a button.
 *
 * The cost, stated plainly because it is a real one: in Chrome, dictation
 * is not on-device. The browser streams the microphone to Google's speech
 * service and returns text. A manager dictating "check Ada Lovelace in"
 * has sent a guest's name to a third party that InnPilot has no agreement
 * with. Three things follow, and all three are implemented here:
 *
 *   1. It is never listening on its own. A dictation session exists only
 *      between a click and a result, and `continuous` is off.
 *   2. The transcript lands in the composer for the user to read and send.
 *      Nothing reaches the hotel's data because a microphone heard it.
 *   3. `VITE_AI_VOICE=off` removes the feature from a deployment that does
 *      not accept the trade — checked here, so one setting covers every
 *      caller rather than each one remembering.
 *
 * ## What is deliberately not here
 *
 * No wake word, no barge-in, no continuous conversation, no server-side
 * STT/TTS, no audio storage. Those are the "full voice conversation" the
 * brief excludes from V1, and each of them needs an architecture decision
 * (where audio lives, who processes it, for how long) that voice input
 * does not.
 */

/**
 * The Web Speech API's recognition half, which `lib.dom` does not declare —
 * it is still vendor-prefixed in the browsers that have it, so the types
 * are ours. Only the members used below are named; a browser giving us
 * more is not our problem.
 */
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [index: number]: { isFinal: boolean; 0: { transcript: string } };
  };
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

interface VoiceWindow {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
  speechSynthesis?: SpeechSynthesis;
  /**
   * Reached through the window rather than as a bare global for the same
   * reason as everything else here: this module is imported by code that
   * runs where there is no browser (a test, an Electron preload), and a
   * bare `new SpeechSynthesisUtterance()` there is a ReferenceError rather
   * than a feature that is politely absent.
   */
  SpeechSynthesisUtterance?: new (text: string) => SpeechSynthesisUtterance;
}

/**
 * `off` disables both halves for the whole deployment. Anything else —
 * including unset — leaves them to browser support, which is the common
 * case and needs no configuration.
 */
function enabledByConfig(): boolean {
  return import.meta.env.VITE_AI_VOICE !== "off";
}

function voiceWindow(): VoiceWindow | null {
  return typeof window === "undefined" ? null : (window as unknown as VoiceWindow);
}

function recognitionConstructor(): SpeechRecognitionConstructor | null {
  const w = voiceWindow();
  if (!w) return null;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceSupport {
  /** Speech -> text: the microphone button exists only when this is true. */
  dictation: boolean;
  /** Text -> speech: replies are spoken only when this is true. */
  speech: boolean;
}

/**
 * What this browser can actually do, asked at render time rather than
 * assumed. Both halves are missing in Firefox and in every non-browser
 * environment, and the UI's rule is to render nothing rather than a button
 * that fails when pressed.
 */
export function detectVoiceSupport(): VoiceSupport {
  if (!enabledByConfig()) return { dictation: false, speech: false };
  const w = voiceWindow();
  return {
    dictation: recognitionConstructor() !== null,
    speech: !!w?.speechSynthesis && !!w?.SpeechSynthesisUtterance,
  };
}

/** The browser's language, or a default where there is no browser. */
function browserLanguage(): string {
  if (typeof navigator === "undefined") return "en-US";
  return navigator.language || "en-US";
}

/**
 * Why a dictation session ended badly, in the user's terms.
 *
 * A closed set built from the spec's error codes, for the same reason the
 * server has `ToolFailureKind`: "not-allowed" is a permissions problem the
 * user can fix and "network" is not, and a single "voice input failed"
 * tells them which one it was — never.
 */
export function dictationErrorMessage(code: string | undefined): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone access is blocked. Allow it in your browser's site settings to dictate.";
    case "no-speech":
      return "I didn't catch anything — try again and speak after the button turns red.";
    case "audio-capture":
      return "No microphone was found.";
    case "network":
      return "Speech recognition needs a network connection, and it couldn't reach the service.";
    case "aborted":
      return "Dictation stopped.";
    default:
      return "Dictation failed. You can type the question instead.";
  }
}

export interface DictationHandlers {
  /** The in-progress guess, replaced on every event. Never sent anywhere. */
  onInterim: (text: string) => void;
  /** A settled phrase. May fire more than once in a session. */
  onFinal: (text: string) => void;
  onError: (message: string) => void;
  /** Always fires last, whether the session ended, was stopped, or failed. */
  onEnd: () => void;
  /** BCP-47 tag; defaults to the browser's own language. */
  lang?: string;
}

export interface DictationSession {
  /** Finish and keep what was heard. */
  stop(): void;
  /** Finish and discard it. */
  cancel(): void;
}

/**
 * Start one dictation session, or return null if this browser cannot.
 *
 * Single-shot by construction: `continuous` is false, so the browser ends
 * the session at a natural pause. A microphone that stays open because a
 * component forgot to close it is exactly the failure this feature cannot
 * afford, so the session ends itself and `onEnd` is guaranteed.
 */
export function startDictation(handlers: DictationHandlers): DictationSession | null {
  const Recognition = enabledByConfig() ? recognitionConstructor() : null;
  if (!Recognition) return null;

  const recognition = new Recognition();
  recognition.lang = handlers.lang ?? browserLanguage();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    handlers.onEnd();
  };

  recognition.onresult = (event) => {
    let interim = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const text = result[0]?.transcript ?? "";
      if (result.isFinal) handlers.onFinal(text.trim());
      else interim += text;
    }
    handlers.onInterim(interim.trim());
  };

  recognition.onerror = (event) => {
    // `aborted` is our own `cancel()` and the user already knows; anything
    // else is something they may be able to act on.
    if (event.error !== "aborted") handlers.onError(dictationErrorMessage(event.error));
  };

  recognition.onend = end;

  try {
    recognition.start();
  } catch {
    // Chrome throws if start() is called on an already-started instance.
    // Nothing is listening, so report it and end rather than leaving the
    // caller in a permanent "listening" state.
    handlers.onError(dictationErrorMessage(undefined));
    end();
    return null;
  }

  return {
    stop: () => recognition.stop(),
    cancel: () => recognition.abort(),
  };
}

/** A reply longer than this is summarised aloud as "see the screen". */
const MAX_SPOKEN_CHARS = 700;

const TOO_LONG_SUFFIX = " The rest of the answer is on screen.";

/**
 * A reply as it should be *heard*.
 *
 * The prompt is not told that a question was spoken — that is the whole
 * input-source-agnostic rule, and bending it would mean the agent giving
 * one answer to a typed question and a different one to the same question
 * spoken. So the reply arrives written for the eye, with markdown emphasis
 * and bullets in it, and the adjustment happens here, on the way to the
 * speaker, where it changes nothing else.
 *
 * Cutting it at a sentence boundary matters more than the exact limit: a
 * four-minute recitation of a full daily report is not useful, and a
 * recitation that stops mid-number is worse than one that stops cleanly
 * and says where to look.
 */
export function speakableText(reply: string, maxChars: number = MAX_SPOKEN_CHARS): string {
  const plain = reply
    // Fenced and inline code: read the content, not the punctuation.
    .replace(/```[a-z]*\n?/gi, " ")
    .replace(/`([^`]*)`/g, "$1")
    // Bold/italic markers, kept as the words inside them.
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|\s)\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|\s)_([^_\n]+)_/g, "$1$2")
    // Headings and list bullets: the marker is layout, not speech.
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    // Link syntax, keeping the label.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (plain.length <= maxChars) return plain;

  const cut = plain.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  const spoken = lastStop > maxChars / 2 ? cut.slice(0, lastStop + 1) : `${cut.trimEnd()}…`;
  return spoken + TOO_LONG_SUFFIX;
}

/**
 * Say something, replacing whatever was being said.
 *
 * Only ever called with an assistant reply. Tool arguments, tool results
 * and error internals are not spoken: the same rule the audit trail and
 * the logs follow, for the same reason — a room full of people can hear a
 * speaker, and the reply is the only part the user asked to be told.
 */
export function speak(text: string, lang?: string): void {
  const w = voiceWindow();
  const synth = w?.speechSynthesis;
  const Utterance = w?.SpeechSynthesisUtterance;
  if (!enabledByConfig() || !synth || !Utterance || !text) return;

  // Cancel first: two answers read over each other is worse than either.
  synth.cancel();
  const utterance = new Utterance(text);
  utterance.lang = lang ?? browserLanguage();
  synth.speak(utterance);
}

/** Stop mid-sentence — a new turn, a closed page, or the mute toggle. */
export function stopSpeaking(): void {
  voiceWindow()?.speechSynthesis?.cancel();
}
