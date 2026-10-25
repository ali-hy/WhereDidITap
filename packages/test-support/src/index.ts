// @budmon/test-support: test tooling shared by the test suites and the rehearsal harness
// (LLD §10.1). Owned by the test-architect.
export { CANARIES, scanForCanaries, type Canaries, type CanaryHit } from "./canaries.js";
export { createTestUser, type TestUserDatabase } from "./testUser.js";
