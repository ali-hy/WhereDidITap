// F-209 ErrorFallback (§8.1 S-2). TP-11.7, with B-6 (spinner), A-397 (stillFailing) and A-400 (the
// status element is always rendered).
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { loadErrorFallback, plain } from "../support/s11b.js";
import { renderWithI18n } from "../support/render.js";

const REQUEST_ID = "4bf92f35ab12cd34ef567890abcdef12";

describe("TP-11.7: ErrorFallback (F-209)", () => {
  it("TP-11.7: title, body and Reference: 4bf92f35 in <bdi dir=ltr>; during the retry the button is aria-busy and disabled; after the retry fails, Still not working. appears", async () => {
    const { ErrorFallback } = await loadErrorFallback();
    let reject: (err: Error) => void = () => undefined;
    let retries = 0;
    const onRetry = () => {
      retries += 1;
      return new Promise<void>((_resolve, rej) => {
        reject = rej;
      });
    };
    const { container } = renderWithI18n(() => (
      <ErrorFallback error={{ kind: "unknown" }} requestId={REQUEST_ID} onRetry={onRetry} />
    ));

    const title = await screen.findByRole("heading", { level: 1 });
    expect(plain(title.textContent)).toBe("Something went wrong on our side");
    expect(plain(container.textContent)).toContain(
      "Try again in a moment. If it keeps happening, share this reference with the person who invited you.",
    );
    expect(plain(container.textContent)).toContain("Reference: 4bf92f35");
    expect(plain(container.textContent)).not.toContain("4bf92f35ab");
    const bdi = container.querySelector("bdi");
    expect(plain(bdi?.textContent)).toContain("4bf92f35");
    expect(bdi?.getAttribute("dir")).toBe("ltr");
    expect(plain(container.textContent)).not.toContain("Still not working.");

    const button = screen.getByRole("button", { name: /Try again/ });
    const spinner = () => button.querySelector('[aria-hidden="true"]');
    expect(spinner()).toBeNull();
    fireEvent.click(button);

    await waitFor(() => {
      expect(button.getAttribute("aria-busy")).toBe("true");
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    // B-6: a decorative (aria-hidden) spinner inside the button while busy.
    expect(spinner()).not.toBeNull();
    expect(plain(button.textContent)).toContain("Try again");
    expect(retries).toBe(1);

    reject(new Error("still down"));

    await waitFor(() => {
      expect(plain(container.textContent)).toContain("Still not working.");
    });
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    expect((button as HTMLButtonElement).disabled).toBe(false);
    expect(spinner()).toBeNull();
  });

  it("TP-11.7: the Go to home link goes to /", async () => {
    const { ErrorFallback } = await loadErrorFallback();
    renderWithI18n(() => (
      <ErrorFallback error={{ kind: "unknown" }} onRetry={() => Promise.resolve()} />
    ));

    const home = await screen.findByRole("link", { name: /Go to home/ });

    expect(home.getAttribute("href")).toBe("/");
  });

  it("TP-11.7: without a requestId there's no Reference line", async () => {
    const { ErrorFallback } = await loadErrorFallback();
    const { container } = renderWithI18n(() => (
      <ErrorFallback error={{ kind: "unknown" }} onRetry={() => Promise.resolve()} />
    ));

    await screen.findByRole("heading", { level: 1 });

    expect(plain(container.textContent)).not.toContain("Reference:");
    expect(container.querySelector("bdi")).toBeNull();
  });
});

describe("TP-11.7 (A-397, A-400): the still-failing state and its status element", () => {
  it("TP-11.7 (A-400): before any retry, the empty role=status element is already in the DOM", async () => {
    const { ErrorFallback } = await loadErrorFallback();
    renderWithI18n(() => (
      <ErrorFallback error={{ kind: "unknown" }} onRetry={() => Promise.resolve()} />
    ));

    const status = await screen.findByRole("status");

    expect(plain(status.textContent)).toBe("");
  });

  it("TP-11.7 (A-397): rendered with stillFailing, Still not working. shows in that status element", async () => {
    const { ErrorFallback } = await loadErrorFallback();
    renderWithI18n(() => (
      <ErrorFallback
        error={{ kind: "unknown" }}
        onRetry={() => Promise.resolve()}
        stillFailing={true}
      />
    ));

    const status = await screen.findByRole("status");

    expect(plain(status.textContent)).toBe("Still not working.");
  });
});
