// F-4: stylelint for the web app's CSS (D-38). Physical properties are errors; a declaration that
// must stay physical is preceded by
// `/* stylelint-disable-next-line csstools/use-logical -- rtl-exempt: <reason> */` (A-322).
import rtlExemptReason from "./rules/rtl-exempt-reason.js";

export default {
  plugins: ["stylelint-use-logical", rtlExemptReason],
  rules: {
    // First, so the invalid disables it drops no longer exempt use-logical's warnings.
    "budmon/rtl-exempt-reason": true,
    "csstools/use-logical": ["always", { except: [] }],
  },
};
