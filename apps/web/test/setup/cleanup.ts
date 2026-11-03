// web-unit set-up file: Vitest globals are off, so @solidjs/testing-library can't register its own
// afterEach; unmount every render after each test here, or renders pile up across tests.
import { cleanup } from "@solidjs/testing-library";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
