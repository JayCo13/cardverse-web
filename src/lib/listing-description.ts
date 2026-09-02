/**
 * The length a listing description must fall within, and the numbers the
 * counters show.
 *
 * Lives here rather than in either page because the create form, the edit form
 * and both API routes all need it, and they drifted apart repeatedly: the
 * create form was lowered to 100 when the generator was shortened, the edit
 * form was not, and neither server route was told at all — it kept rejecting
 * anything under 300, so a description the form called valid came back a 400.
 * The counter denominator was the minimum too, which rendered a perfectly good
 * 189-character description as "189/100", i.e. as if it were over a limit.
 *
 * Import these two constants everywhere. Do not re-type the numbers.
 *
 * The AI generator targets 120-200 characters so its output clears the minimum
 * comfortably — measured across four runs of each candidate model, the shortest
 * answer was 116.
 */
export const DESCRIPTION_MIN = 100;
export const DESCRIPTION_MAX = 3000;
