// Sets <html data-theme data-mode> before first paint (UX guide §3.5). Synchronous and same
// origin, so the CSP stays as it is. The device cache is localStorage["budmon.theme"].
(function () {
  var mode;
  try {
    var cached = localStorage.getItem("budmon.theme");
    if (cached === "light" || cached === "dark") mode = cached;
  } catch (e) {
    mode = undefined;
  }
  if (mode === undefined) {
    var dark = false;
    try {
      dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch (e) {
      dark = false;
    }
    mode = dark ? "dark" : "light";
  }
  var root = document.documentElement;
  root.setAttribute("data-theme", "teal");
  root.setAttribute("data-mode", mode);
})();
