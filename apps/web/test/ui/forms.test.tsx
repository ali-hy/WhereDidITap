// F-213 form error helpers (J-2). TP-11.9, plus extra cases TP-11.32x. IDs ending in "x" are
// test-architect additions, not LLD test-plan IDs.
import { screen, waitFor } from "@solidjs/testing-library";
import { createSignal, type JSX } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { type FormField, type Issue, loadForms, plain } from "../support/s11b.js";

type FormsModule = Awaited<ReturnType<typeof loadForms>>;
import { renderWithI18n } from "../support/render.js";

const ISSUES: readonly Issue[] = [
  { code: "too_small", path: ["amount"], message: "Too small: expected number to be >0" },
  { code: "invalid_value", path: ["unknown", "path"], message: "Invalid input" },
];

/**
 * A two-field form wired the way J-2 describes: each input has aria-invalid and
 * aria-describedby pointing at its FieldError, and the summary above.
 */
function harness(forms: FormsModule) {
  const [amountError, setAmountError] = createSignal<string>();
  const [noteError, setNoteError] = createSignal<string>();
  const [summary, setSummary] = createSignal<readonly { fieldId?: string; text: string }[]>([]);
  const fields: Record<string, FormField> = {
    amount: { id: "amount", label: "Amount", setError: setAmountError },
    note: { id: "note", label: "Note", setError: setNoteError },
  };
  const Form = (): JSX.Element => (
    <form>
      <forms.FormErrorSummary messages={summary()} />
      <label for="amount">Amount</label>
      <input
        id="amount"
        aria-invalid={amountError() === undefined ? undefined : "true"}
        aria-describedby="amount-error"
      />
      <forms.FieldError id="amount-error" message={amountError()} />
      <label for="note">Note</label>
      <input
        id="note"
        aria-invalid={noteError() === undefined ? undefined : "true"}
        aria-describedby="note-error"
      />
      <forms.FieldError id="note-error" message={noteError()} />
    </form>
  );
  return { fields, Form, setSummary, amountError, noteError };
}

describe("TP-11.9: server validation issues on a form (F-213)", () => {
  it("TP-11.9 (b): [amount too_small] sets amount's error to validation.too_small; [unknown.path invalid_value] goes to the summary as error.validation.unknownField with the path, after error.validation.form; the summary takes focus", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n, container } = renderWithI18n(() => <h.Form />);
    const noteSpy = vi.spyOn(h.fields.note as FormField, "setError");

    const { summary, focus } = forms.applyServerIssues(ISSUES, h.fields, i18n.t);
    h.setSummary(summary);

    expect(focus).toBe("summary");
    expect(h.amountError()).toBe("This is too short or too small.");
    expect(noteSpy).not.toHaveBeenCalled();
    expect(summary.map((m) => ({ ...m, text: plain(m.text) }))).toEqual([
      { text: "Some details need fixing." },
      { text: "Something in this form isn't valid: unknown.path" },
    ]);

    const amount = container.querySelector<HTMLInputElement>("#amount");
    expect(amount?.getAttribute("aria-invalid")).toBe("true");
    const fieldError = container.querySelector("#amount-error");
    expect(plain(fieldError?.textContent)).toContain("This is too short or too small.");

    const alert = await screen.findByRole("alert");
    expect(plain(alert.textContent)).toContain("Some details need fixing.");
    expect(plain(alert.textContent)).toContain("Something in this form isn't valid: unknown.path");
    await waitFor(() => {
      expect(alert.contains(document.activeElement)).toBe(true);
    });
  });

  it("TP-11.32x: an issue code without a validation.<code> message falls back to validation.invalid", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n } = renderWithI18n(() => <h.Form />);

    forms.applyServerIssues(
      [{ code: "custom_rule", path: ["note"], message: "x" }],
      h.fields,
      i18n.t,
    );

    expect(h.noteError()).toBe("Enter a valid value.");
  });

  // A-399: every issue maps to a field: no summary, focus on the first invalid field.
  it("TP-11.9 (a): [amount too_small] alone: amount's error and aria-invalid, no summary rendered, focus on amount", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n, container } = renderWithI18n(() => <h.Form />);

    const { summary, focus } = forms.applyServerIssues([ISSUES[0] as Issue], h.fields, i18n.t);
    h.setSummary(summary);

    expect(summary).toEqual([]);
    expect(focus).toEqual({ fieldId: "amount" });
    expect(h.amountError()).toBe("This is too short or too small.");
    expect(container.querySelector("#amount")?.getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("amount");
    });
  });

  it("TP-11.32x (A-399): with both fields invalid, focus goes to the first in DOM order (amount), whatever the issue order", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n } = renderWithI18n(() => <h.Form />);

    const { focus } = forms.applyServerIssues(
      [
        { code: "too_big", path: ["note"], message: "x" },
        { code: "too_small", path: ["amount"], message: "x" },
      ],
      h.fields,
      i18n.t,
    );

    expect(focus).toEqual({ fieldId: "amount" });
    await waitFor(() => {
      expect(document.activeElement?.id).toBe("amount");
    });
  });

  it("TP-11.32x: FieldError renders its message with the given id; without a message it renders no text", async () => {
    const forms = await loadForms();
    const { container } = renderWithI18n(() => (
      <>
        <forms.FieldError id="with" message="Check the format." />
        <forms.FieldError id="without" />
      </>
    ));

    expect(plain(container.querySelector("#with")?.textContent)).toContain("Check the format.");
    expect(plain(container.querySelector("#without")?.textContent ?? "")).toBe("");
  });
});

// A-460: form-level issues, nested paths by whole-segment longest prefix, first issue wins.
describe("TP-11.9 (A-460): applyServerIssues path rules", () => {
  const issue = (path: (string | number)[], code: string): Issue => ({
    code,
    path,
    message: "server text",
  });
  const plainSummary = (s: readonly { fieldId?: string; text: string }[]) =>
    s.map((m) => ({ ...m, text: plain(m.text) }));

  it("TP-11.9 (c): [[] invalid_type] adds error.validation.form + validation.invalid_type to the summary, no unknownField, focus on the summary", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n } = renderWithI18n(() => <h.Form />);

    const { summary, focus } = forms.applyServerIssues(
      [issue([], "invalid_type")],
      h.fields,
      i18n.t,
    );

    expect(plainSummary(summary)).toEqual([
      { text: "Some details need fixing." },
      { text: "Enter a valid value." },
    ]);
    expect(summary.some((m) => plain(m.text).includes("isn't valid:"))).toBe(false);
    expect(focus).toBe("summary");
    expect(h.amountError()).toBeUndefined();
  });

  it("TP-11.9 (d): [amount.0 too_small] reaches amount; no summary; focus amount", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n } = renderWithI18n(() => <h.Form />);

    const { summary, focus } = forms.applyServerIssues(
      [issue(["amount", 0], "too_small")],
      h.fields,
      i18n.t,
    );

    expect(h.amountError()).toBe("This is too short or too small.");
    expect(summary).toEqual([]);
    expect(focus).toEqual({ fieldId: "amount" });
  });

  it("TP-11.9 (e): [amount too_small], [amount.1 too_big]: only the first sets amount's error (setError once); no summary", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n } = renderWithI18n(() => <h.Form />);
    const spy = vi.spyOn(h.fields.amount as FormField, "setError");

    const { summary } = forms.applyServerIssues(
      [issue(["amount"], "too_small"), issue(["amount", 1], "too_big")],
      h.fields,
      i18n.t,
    );

    expect(spy).toHaveBeenCalledTimes(1);
    expect(h.amountError()).toBe("This is too short or too small.");
    expect(summary).toEqual([]);
  });

  it("TP-11.9 (f): fields amount and amount.currency, [amount.currency.code invalid_format]: amount.currency shows it, amount has none", async () => {
    const forms = await loadForms();
    const [amountError, setAmountError] = createSignal<string>();
    const [currencyError, setCurrencyError] = createSignal<string>();
    const fields: Record<string, FormField> = {
      amount: { id: "amount", label: "Amount", setError: setAmountError },
      "amount.currency": { id: "amount-currency", label: "Currency", setError: setCurrencyError },
    };
    const { i18n } = renderWithI18n(() => (
      <form>
        <input id="amount" />
        <input id="amount-currency" />
      </form>
    ));

    const { summary } = forms.applyServerIssues(
      [issue(["amount", "currency", "code"], "invalid_format")],
      fields,
      i18n.t,
    );

    expect(currencyError()).toBe("Check the format.");
    expect(amountError()).toBeUndefined();
    expect(summary).toEqual([]);
  });

  it("TP-11.9 (g): [amounts too_small] matches no field (whole segments only): the summary names the path amounts", async () => {
    const forms = await loadForms();
    const h = harness(forms);
    const { i18n } = renderWithI18n(() => <h.Form />);

    const { summary, focus } = forms.applyServerIssues(
      [issue(["amounts"], "too_small")],
      h.fields,
      i18n.t,
    );

    expect(h.amountError()).toBeUndefined();
    expect(plainSummary(summary)).toEqual([
      { text: "Some details need fixing." },
      { text: "Something in this form isn't valid: amounts" },
    ]);
    expect(focus).toBe("summary");
  });
});
