// The jam build (npm run build:jam, vite.jam.config.js) defines __JAM__ as true;
// the normal build and the dev server define it as false (vite.config.js).
// typeof keeps plain-Node scripts (validate, sim) working where no define runs.
export const JAM = typeof __JAM__ !== 'undefined' && __JAM__;
