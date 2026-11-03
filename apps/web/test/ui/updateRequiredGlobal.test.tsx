// F-210 with the global clientUpdateRequired signal (A-325). TP-11.12 (b). A file of its own:
// markClientUpdateRequired is one-way, so the global stays set for the rest of the file.
import { screen, within } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { loadClientUpdate, loadUpdateNotifier, plain } from "../support/s11b.js";
import { renderWithI18n } from "../support/render.js";

describe("TP-11.12: update required banner from the global signal (F-210, A-325)", () => {
  it('TP-11.12 (b): after markClientUpdateRequired(), UpdateNotifier without updateRequired shows a persistent role="alert" banner with Reload', async () => {
    const { clientUpdateRequired, markClientUpdateRequired } = await loadClientUpdate();
    const { UpdateNotifier } = await loadUpdateNotifier();
    expect(clientUpdateRequired()).toBe(false);

    markClientUpdateRequired();
    renderWithI18n(() => (
      <UpdateNotifier
        buildNumber={7}
        fetchVersion={() => Promise.resolve({ buildNumber: 7 })}
        schedule={() => () => undefined}
      />
    ));

    expect(clientUpdateRequired()).toBe(true);
    const banner = await screen.findByRole("alert");
    expect(plain(banner.textContent)).toContain(
      "This version of Budmon is out of date. Reload to continue.",
    );
    expect(within(banner).getByRole("button", { name: "Reload" })).toBeTruthy();
  });
});
