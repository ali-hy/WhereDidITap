// F-156 TwoStepForm's client rules (identity LLD §8.1 "Forms and validation"; HLD J-5), and F-166's
// submitLabel (A-99 W2). TP-4.30x: TP-4.30 covers the form end to end; these cases pin the client
// rules, which no row names.
// IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
import { fireEvent, screen } from "@solidjs/testing-library";
import { describe, expect, it, vi } from "vitest";
import { TwoStepForm } from "../../src/identity/components/TwoStepForm.js";
import { renderWithI18n } from "../support/render.js";

function mount(allowRecovery: boolean, submitLabel?: { id: string; defaultMessage: string }) {
  const onSubmit = vi.fn<(v: { code?: string; recoveryCode?: string }) => Promise<void>>(() =>
    Promise.resolve(),
  );
  renderWithI18n(() =>
    submitLabel === undefined ? (
      <TwoStepForm onSubmit={onSubmit} allowRecovery={allowRecovery} busy={false} />
    ) : (
      <TwoStepForm
        onSubmit={onSubmit}
        allowRecovery={allowRecovery}
        busy={false}
        submitLabel={submitLabel}
      />
    ),
  );
  return { onSubmit };
}

const type = (label: string, value: string) => {
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
};
const verify = () => {
  fireEvent.click(screen.getByRole("button", { name: "Verify" }));
};

describe("TP-4.30x: TwoStepForm (F-156) client rules", () => {
  it("TP-4.30x: the code field is numeric with one-time-code autofill", () => {
    mount(true);

    const code = screen.getByLabelText("Code");

    expect(code.getAttribute("inputmode")).toBe("numeric");
    expect(code.getAttribute("autocomplete")).toBe("one-time-code");
  });

  it("TP-4.30x: a 6-digit code typed with a space is submitted as the 6 digits", async () => {
    const { onSubmit } = mount(true);

    type("Code", "123 456");
    verify();

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({ code: "123456" });
  });

  it("TP-4.30x: five digits → 'Enter the 6 digits from your app.' and nothing is submitted", async () => {
    const { onSubmit } = mount(true);

    type("Code", "12345");
    verify();

    expect(await screen.findByText("Enter the 6 digits from your app.")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("TP-4.30x: 'Use a recovery code instead' switches to a Recovery code text field that submits recoveryCode only", async () => {
    const { onSubmit } = mount(true);

    fireEvent.click(screen.getByText("Use a recovery code instead"));
    const field = screen.getByLabelText("Recovery code");
    expect(field.getAttribute("autocapitalize")).toBe("characters");
    expect(screen.queryByLabelText("Code")).toBeNull();
    type("Recovery code", "7KQ2-M3XD-4TRA");
    verify();

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    const [value] = onSubmit.mock.calls[0] ?? [];
    expect(
      Object.keys(value ?? {}).filter((k) => value?.[k as keyof typeof value] !== undefined),
    ).toEqual(["recoveryCode"]);
    expect(value?.recoveryCode?.replace(/[-\s]/g, "")).toBe("7KQ2M3XD4TRA");
  });

  it.each([
    ["7KQ2-M3XD", "8 characters"],
    ["7KQ2-M9XD-4TRA", "a 9, which isn't base32"],
  ])(
    "TP-4.30x: recovery code %j (%s) → 'Enter a code like 7KQ2-M3XD-4TRA.' and nothing is submitted",
    async (input) => {
      const { onSubmit } = mount(true);

      fireEvent.click(screen.getByText("Use a recovery code instead"));
      type("Recovery code", input);
      verify();

      expect(await screen.findByText("Enter a code like 7KQ2-M3XD-4TRA.")).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();
    },
  );

  it("TP-4.30x: 'Use a code from your app' switches back to the Code field", () => {
    mount(true);

    fireEvent.click(screen.getByText("Use a recovery code instead"));
    fireEvent.click(screen.getByText("Use a code from your app"));

    expect(screen.getByLabelText("Code")).toBeTruthy();
    expect(screen.queryByLabelText("Recovery code")).toBeNull();
  });

  it("TP-4.30x: with allowRecovery false there's no 'Use a recovery code instead'", () => {
    mount(false);

    expect(screen.getByLabelText("Code")).toBeTruthy();
    expect(screen.queryByText("Use a recovery code instead")).toBeNull();
  });

  it("TP-4.30x (A-99 W2): with submitLabel confirm.submit the button reads 'Confirm' (no Verify) and submits the code", async () => {
    const { onSubmit } = mount(false, { id: "confirm.submit", defaultMessage: "Confirm" });

    expect(screen.queryByRole("button", { name: "Verify" })).toBeNull();
    type("Code", "123456");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await vi.waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith({ code: "123456" });
  });
});
