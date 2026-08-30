/**
 * Shortest description a seller may save, and the number the counter shows.
 *
 * Lives here rather than in either page because both need it and they drifted
 * apart once already: the create form was lowered when the generator was
 * shortened and the edit form was not, which left a description long enough to
 * publish a listing and too short to ever edit one.
 *
 * The AI generator targets 120-200 characters so its output clears this
 * comfortably — measured across four runs of each candidate model, the shortest
 * answer was 116.
 */
export const DESCRIPTION_MIN = 100;
