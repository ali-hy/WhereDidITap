// F-154: reads a token from the URL fragment and removes the fragment from the address bar (D-11).

/** `t`, `h` or `e` from `location.hash`; the fragment is cleared whether or not the key is there. */
export function readFragmentToken(key: "t" | "h" | "e"): string | null {
  const hash = location.hash;
  const value = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash).get(key);
  if (hash !== "") history.replaceState(null, "", location.pathname + location.search);
  return value;
}
