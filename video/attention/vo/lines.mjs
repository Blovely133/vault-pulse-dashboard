// Voiceover manifest shared by generate.mjs (which synthesizes the clips via
// ElevenLabs) and render.mjs (which mixes them). `t` is when the line starts;
// `endBy` is the hard slot boundary — the mixer time-compresses a clip that
// would overrun it (atempo, capped 1.3x) so lines never collide.
export const VO_LINES = [
  {
    file: "01-hook.mp3",
    t: 0.05,
    endBy: 6.9,
    text:
      "Watch the red dot. When the timer ends, you'll see what almost everyone misses. Don't look away.",
  },
  { file: "02-quit.mp3", t: 7.05, endBy: 9.05, text: "Most people give up around second nine." },
  { file: "03-notyou.mp3", t: 9.2, endBy: 9.95, text: "Not you." },
  { file: "04-two.mp3", t: 13.4, endBy: 14.5, text: "There were two." },
  { file: "05-there.mp3", t: 14.65, endBy: 16.35, text: "It was there the whole time." },
  { file: "06-again.mp3", t: 16.5, endBy: 17.9, text: "Now watch it again." },
];
