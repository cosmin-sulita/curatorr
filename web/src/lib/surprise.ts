/**
 * Set when "Surprise me" is tapped, so the pick screen opens with a poster shuffle.
 * In memory only: reloading /pick or coming back to it with the back button doesn't shuffle again.
 */
let pending = false;

export const requestSurprise = () => {
  pending = true;
};

/** Pure, so it's safe to read while rendering. */
export const surprisePending = () => pending;

export const clearSurprise = () => {
  pending = false;
};
