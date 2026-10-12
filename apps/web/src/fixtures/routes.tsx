// The fixture routes (§8.1, A-328, A-330 to A-332): development and E2E builds only
// (VITE_FIXTURES=1). Their literal strings are exempt from the catalog rules.
import { createRoute, type AnyRoute } from "@tanstack/solid-router";
import { A11yViolationFixture } from "./A11yViolationFixture.js";
import { failingLoader, FailingLoaderFixture } from "./FailingLoaderFixture.js";
import { flakyLoader, FlakyLoaderFixture } from "./FlakyLoaderFixture.js";
import { KobalteSpikeFixture } from "./KobalteSpikeFixture.js";
import { RtlProbeFixture } from "./RtlProbeFixture.js";
import { startFixtureWorker, VirtualTableFixture } from "./VirtualTableFixture.js";

export function createFixtureRoutes(rootRoute: AnyRoute): AnyRoute[] {
  const route = (path: string, component: () => unknown, loader?: () => unknown) =>
    createRoute({
      getParentRoute: () => rootRoute,
      path,
      component: component as never,
      ...(loader === undefined ? {} : { loader }),
    }) as unknown as AnyRoute;
  return [
    route("/__fixtures/rtl-probe", RtlProbeFixture),
    route("/__fixtures/flaky-loader", FlakyLoaderFixture, flakyLoader),
    route("/__fixtures/failing-loader", FailingLoaderFixture, failingLoader),
    route("/__fixtures/a11y-violation", A11yViolationFixture),
    route("/__fixtures/kobalte-spike", KobalteSpikeFixture),
    route("/__fixtures/virtual-table", VirtualTableFixture, startFixtureWorker),
  ];
}
