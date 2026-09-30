// URL dev params (e.g. ?battle=boss_clerk&echo=10). Not linked from anywhere;
// they work in the production build so they can be tested on a phone.
export function devParam(name) {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch (err) {
    // no URL access (e.g. sandboxed webview)
    return null;
  }
}

export function devInt(name) {
  const value = parseInt(devParam(name), 10);
  return Number.isFinite(value) ? value : null;
}
