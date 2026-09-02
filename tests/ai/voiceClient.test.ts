/**
 * The browser half of voice (Phase 14) — `src/lib/voice.ts`.
 *
 * Three things are worth pinning here, and none of them is "the Web Speech
 * API works":
 *
 *   1. **Absence is a supported state.** No browser, no Web Speech API, or
 *      `VITE_AI_VOICE=off` must each produce a module that reports "no"
 *      and does nothing — never a ReferenceError from a bare global. That
 *      is what lets the UI render a page with no microphone rather than a
 *      page that breaks in Firefox.
 *   2. **A failure says which failure it was.** A blocked microphone is
 *      something the user can fix and a network outage is not; one
 *      "voice input failed" for both is the message that helps nobody.
 *   3. **A reply is shortened for the ear, not for the eye.** The prompt
 *      is deliberately not told that a question was spoken, so the reply
 *      arrives written for a screen; everything that makes it listenable
 *      happens here, on the way to the speaker, where it changes nothing
 *      the user reads.
 *
 * The recogniser is a stand-in that fires the events the spec describes.
 * Testing against the real one would be testing Chrome.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  detectVoiceSupport,
  dictationErrorMessage,
  speak,
  speakableText,
  startDictation,
  stopSpeaking,
} from "../../src/lib/voice";

/** The events one session emitted, in order, as the caller saw them. */
interface Captured {
  interim: string[];
  final: string[];
  errors: string[];
  ended: number;
}

/** A stand-in for the browser's recogniser, driven by the test. */
class FakeRecognition {
  static last: FakeRecognition | null = null;
  /** Set to make `start()` throw, as Chrome does on a double start. */
  static failOnStart = false;

  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  started = false;
  stopped = false;
  aborted = false;

  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.last = this;
  }

  start(): void {
    if (FakeRecognition.failOnStart) throw new Error("already started");
    this.started = true;
  }

  stop(): void {
    this.stopped = true;
  }

  abort(): void {
    this.aborted = true;
  }

  /** Deliver one batch of results, as the API delivers them. */
  emit(results: { transcript: string; isFinal: boolean }[], resultIndex = 0): void {
    const list: Record<number, unknown> & { length: number } = { length: results.length };
    results.forEach((result, index) => {
      list[index] = { isFinal: result.isFinal, 0: { transcript: result.transcript } };
    });
    this.onresult?.({ resultIndex, results: list });
  }

  fail(error: string): void {
    this.onerror?.({ error });
  }

  end(): void {
    this.onend?.();
  }
}

class FakeUtterance {
  lang = "";
  constructor(public text: string) {}
}

/** What the synthesiser was asked to say, in order. */
const spoken: { text: string; lang: string }[] = [];
let cancels = 0;

const fakeSynthesis = {
  cancel: () => {
    cancels += 1;
  },
  speak: (utterance: FakeUtterance) => {
    spoken.push({ text: utterance.text, lang: utterance.lang });
  },
};

/** Install a browser with both halves of the API present. */
function installBrowser(options: { recognition?: boolean; synthesis?: boolean } = {}): void {
  const { recognition = true, synthesis = true } = options;
  vi.stubGlobal("window", {
    ...(recognition ? { webkitSpeechRecognition: FakeRecognition } : {}),
    ...(synthesis
      ? { speechSynthesis: fakeSynthesis, SpeechSynthesisUtterance: FakeUtterance }
      : {}),
  });
}

function listen(): Captured {
  const captured: Captured = { interim: [], final: [], errors: [], ended: 0 };
  startDictation({
    onInterim: (text) => captured.interim.push(text),
    onFinal: (text) => captured.final.push(text),
    onError: (message) => captured.errors.push(message),
    onEnd: () => {
      captured.ended += 1;
    },
    lang: "en-GB",
  });
  return captured;
}

beforeEach(() => {
  FakeRecognition.last = null;
  FakeRecognition.failOnStart = false;
  spoken.length = 0;
  cancels = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("a browser that cannot do this is a supported browser", () => {
  it("reports no support outside a browser, without throwing", () => {
    expect(detectVoiceSupport()).toEqual({ dictation: false, speech: false });
  });

  it("returns no session to start, rather than failing to start one", () => {
    expect(startDictation({ ...noHandlers() })).toBeNull();
  });

  it("says nothing rather than throwing when there is no synthesiser", () => {
    expect(() => speak("You are 50% full.")).not.toThrow();
    expect(() => stopSpeaking()).not.toThrow();
    expect(spoken).toEqual([]);
  });

  it("reports each half separately, since a browser can have one", () => {
    installBrowser({ recognition: true, synthesis: false });
    expect(detectVoiceSupport()).toEqual({ dictation: true, speech: false });

    installBrowser({ recognition: false, synthesis: true });
    expect(detectVoiceSupport()).toEqual({ dictation: false, speech: true });
  });

  it("finds the vendor-prefixed recogniser Chrome actually ships", () => {
    installBrowser();
    expect(detectVoiceSupport()).toEqual({ dictation: true, speech: true });
  });

  it("is switched off entirely by VITE_AI_VOICE=off, browser support or not", () => {
    installBrowser();
    vi.stubEnv("VITE_AI_VOICE", "off");

    expect(detectVoiceSupport()).toEqual({ dictation: false, speech: false });
    expect(startDictation({ ...noHandlers() })).toBeNull();
    speak("You are 50% full.");
    expect(spoken).toEqual([]);
  });
});

describe("one dictation session", () => {
  it("is single-shot and interim, so a microphone cannot be left open", () => {
    installBrowser();
    listen();

    expect(FakeRecognition.last?.started).toBe(true);
    expect(FakeRecognition.last?.continuous).toBe(false);
    expect(FakeRecognition.last?.interimResults).toBe(true);
    expect(FakeRecognition.last?.lang).toBe("en-GB");
  });

  it("reports the running guess and the settled phrase separately", () => {
    installBrowser();
    const captured = listen();

    FakeRecognition.last?.emit([{ transcript: "what is our occ", isFinal: false }]);
    FakeRecognition.last?.emit([{ transcript: "What is our occupancy? ", isFinal: true }]);

    expect(captured.interim).toEqual(["what is our occ", ""]);
    // Trimmed, because the composer puts it next to whatever is already there.
    expect(captured.final).toEqual(["What is our occupancy?"]);
  });

  it("ends exactly once, however it ended", () => {
    installBrowser();
    const captured = listen();

    FakeRecognition.last?.end();
    FakeRecognition.last?.end();

    expect(captured.ended).toBe(1);
  });

  it("stops and cancels through the recogniser's own two verbs", () => {
    installBrowser();
    const session = startDictation({ ...noHandlers() });

    session?.stop();
    expect(FakeRecognition.last?.stopped).toBe(true);
    expect(FakeRecognition.last?.aborted).toBe(false);

    session?.cancel();
    expect(FakeRecognition.last?.aborted).toBe(true);
  });

  it("names the failure the user can act on", () => {
    installBrowser();
    const captured = listen();

    FakeRecognition.last?.fail("not-allowed");

    expect(captured.errors).toEqual([
      "Microphone access is blocked. Allow it in your browser's site settings to dictate.",
    ]);
  });

  it("does not report a stop the user asked for as a failure", () => {
    installBrowser();
    const captured = listen();

    FakeRecognition.last?.fail("aborted");

    expect(captured.errors).toEqual([]);
  });

  it("distinguishes the codes rather than collapsing them", () => {
    const messages = ["not-allowed", "no-speech", "audio-capture", "network", undefined].map(
      (code) => dictationErrorMessage(code)
    );
    expect(new Set(messages).size).toBe(messages.length);
    expect(dictationErrorMessage("something-new-in-chrome")).toBe(
      dictationErrorMessage(undefined)
    );
  });

  it("reports and ends when the recogniser refuses to start", () => {
    installBrowser();
    FakeRecognition.failOnStart = true;
    const captured = listen();

    // Nothing is listening, so the caller must not be left showing
    // "listening" forever.
    expect(captured.errors).toHaveLength(1);
    expect(captured.ended).toBe(1);
  });
});

describe("a reply on its way to the speaker", () => {
  it("reads the words in markdown, not the markdown", () => {
    const spokenText = speakableText(
      "## Today\n\n- **Occupancy**: 62%\n- *Arrivals*: 4\n\nRevenue was `UGX 1,200,000`."
    );

    expect(spokenText).toBe("Today Occupancy: 62% Arrivals: 4 Revenue was UGX 1,200,000.");
    expect(spokenText).not.toMatch(/[*#`]/);
  });

  it("keeps a link's label and drops its target", () => {
    expect(speakableText("See [the report](https://example.com/x) for detail.")).toBe(
      "See the report for detail."
    );
  });

  it("leaves an ordinary sentence exactly as it is", () => {
    const plain = "Room 204 is now marked as cleaning.";
    expect(speakableText(plain)).toBe(plain);
  });

  it("says nothing for an empty reply", () => {
    expect(speakableText("   \n  ")).toBe("");
  });

  it("stops a long report at a sentence, and says where the rest is", () => {
    const reply = `${"Occupancy is steady. ".repeat(60)}`;
    const spokenText = speakableText(reply, 200);

    expect(spokenText.length).toBeLessThan(280);
    expect(spokenText).toMatch(/The rest of the answer is on screen\.$/);
    // Cut at a full stop, so it never ends halfway through a figure.
    expect(spokenText).toMatch(/steady\. The rest/);
  });

  it("cuts cleanly even when there is no sentence to cut at", () => {
    const spokenText = speakableText("x".repeat(400), 100);
    expect(spokenText).toMatch(/^x+… The rest of the answer is on screen\.$/);
  });
});

describe("speaking", () => {
  it("cancels whatever was being said before starting", () => {
    installBrowser();
    speak("First answer.");
    speak("Second answer.");

    expect(cancels).toBe(2);
    expect(spoken.map((s) => s.text)).toEqual(["First answer.", "Second answer."]);
  });

  it("says nothing when there is nothing to say", () => {
    installBrowser();
    speak("");
    expect(spoken).toEqual([]);
    expect(cancels).toBe(0);
  });

  it("stops mid-sentence on request", () => {
    installBrowser();
    speak("A long answer.");
    stopSpeaking();

    expect(cancels).toBe(2);
  });
});

/** Handlers for a session whose events the test does not care about. */
function noHandlers() {
  return {
    onInterim: () => undefined,
    onFinal: () => undefined,
    onError: () => undefined,
    onEnd: () => undefined,
  };
}
