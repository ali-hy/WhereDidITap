// F-166 withConfirmation with concurrent callers (identity LLD A-83). TP-4.37, an S-4 row written in
// S-3 because the code exists: one dialog for both callers; confirming reruns each run() in call
// order, cancelling resolves each with undefined.
import { ORPCError } from "@orpc/client";
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { ApiProvider } from "../../src/api/ApiProvider.js";
import type { ApiClient } from "../../src/api/client.js";
import {
  ConfirmItsYouDialog,
  withConfirmation,
} from "../../src/identity/components/ConfirmItsYou.js";
import { renderWithI18n } from "../support/render.js";

const confirmationRequired = () =>
  new ORPCError("CONFIRMATION_REQUIRED", {
    defined: true,
    status: 403,
    message: "Confirmation required",
    data: { factor: "password" },
  });

/** A run() that throws CONFIRMATION_REQUIRED the first time and returns `result` after; calls go to `log`. */
function runner(name: string, result: string, log: string[]): () => Promise<string> {
  let calls = 0;
  return () => {
    calls += 1;
    log.push(`${name}${String(calls)}`);
    return calls === 1 ? Promise.reject(confirmationRequired()) : Promise.resolve(result);
  };
}

function mount() {
  const confirm = vi.fn(() => Promise.resolve({ confirmedUntil: "2026-11-17T10:10:00.000Z" }));
  const api = { me: { confirm } } as unknown as ApiClient;
  renderWithI18n(() => (
    <ApiProvider api={api}>
      <ConfirmItsYouDialog />
    </ApiProvider>
  ));
  return { confirm };
}

describe("TP-4.37: withConfirmation with two concurrent callers (A-83)", () => {
  it("TP-4.37: confirming in the one dialog runs each caller's run() once more, in call order, and each resolves with its own result", async () => {
    const { confirm } = mount();
    const log: string[] = [];

    const a = withConfirmation(runner("A", "result A", log));
    const b = withConfirmation(runner("B", "result B", log));
    await screen.findByRole("dialog");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.input(screen.getByLabelText("Password"), {
      target: { value: "violet staircase umbrella" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await expect(a).resolves.toBe("result A");
    await expect(b).resolves.toBe("result B");
    expect(log).toEqual(["A1", "B1", "A2", "B2"]);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith({ password: "violet staircase umbrella" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });

  it("TP-4.37: cancelling the one dialog resolves both callers with undefined; neither run() runs again", async () => {
    const { confirm } = mount();
    const log: string[] = [];

    const c = withConfirmation(runner("C", "result C", log));
    const d = withConfirmation(runner("D", "result D", log));
    await screen.findByRole("dialog");
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await expect(c).resolves.toBeUndefined();
    await expect(d).resolves.toBeUndefined();
    expect(log).toEqual(["C1", "D1"]);
    expect(confirm).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).toBeNull();
    });
  });
});
