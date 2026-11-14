// P-A-515 (b), (c): Skeleton, ComboboxField, RadioGroupField and SignedOutColumn (guide §5.2, §8.4,
// §8.5, §9.1). TP-0b.6x (review B-5). IDs ending in "x" are test-architect additions, not LLD
// test-plan IDs. Kobalte renders the combobox list in a portal, so its class scan covers the body.
import { fireEvent, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComboboxField } from "../../src/ui/ComboboxField.js";
import { RadioGroupField } from "../../src/ui/RadioGroupField.js";
import { SignedOutColumn } from "../../src/ui/SignedOutColumn.js";
import { Skeleton } from "../../src/ui/Skeleton.js";
import { renderWithI18n } from "../support/render.js";
import { badClasses } from "../support/tokenClasses.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("TP-0b.6x: Skeleton (P-A-515 (c))", () => {
  /** The rendered blocks: the aria-hidden root's element children. */
  const blocks = (container: HTMLElement) => {
    const root = container.querySelector('[aria-hidden="true"]');
    return root === null ? [] : [...root.children];
  };

  it("TP-0b.6x: nothing renders for the first 300 ms, then one aria-hidden block", () => {
    vi.useFakeTimers();
    const { container } = renderWithI18n(() => <Skeleton />);

    vi.advanceTimersByTime(299);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(blocks(container)).toHaveLength(0);

    vi.advanceTimersByTime(1);
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
    expect(blocks(container)).toHaveLength(1);
    expect(badClasses(container)).toEqual([]);
  });

  it("TP-0b.6x: rows 3 renders three blocks", () => {
    vi.useFakeTimers();
    const { container } = renderWithI18n(() => <Skeleton rows={3} />);

    vi.advanceTimersByTime(300);

    expect(blocks(container)).toHaveLength(3);
  });

  it("TP-0b.6x: the row and text shapes render differently-sized blocks", () => {
    vi.useFakeTimers();
    const row = renderWithI18n(() => <Skeleton shape="row" />);
    const text = renderWithI18n(() => <Skeleton shape="text" />);
    const plain = renderWithI18n(() => <Skeleton />);

    vi.advanceTimersByTime(300);

    const cls = (c: HTMLElement) => blocks(c)[0]?.getAttribute("class") ?? "";
    expect(cls(row.container)).not.toBe("");
    expect(cls(row.container)).not.toBe(cls(text.container));
    // The default shape is text.
    expect(cls(plain.container)).toBe(cls(text.container));
    expect(badClasses(row.container)).toEqual([]);
  });

  it("TP-0b.6x: unmounted before 300 ms, it never renders (the timer is cleared)", () => {
    vi.useFakeTimers();
    const { container, unmount } = renderWithI18n(() => <Skeleton />);

    unmount();
    vi.advanceTimersByTime(1000);

    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});

const ZONES = [
  { value: "Africa/Cairo", label: "Cairo" },
  { value: "Europe/London", label: "London" },
  { value: "America/New_York", label: "New York" },
  { value: "Asia/Kolkata", label: "Kolkata" },
] as const;

describe("TP-0b.6x: ComboboxField (P-A-515 (b))", () => {
  const field = (
    props: { hint?: string; error?: string; value?: string | null } = {},
  ): {
    input: HTMLInputElement;
    onChange: ReturnType<typeof vi.fn<(v: string | null) => void>>;
  } => {
    const onChange = vi.fn<(v: string | null) => void>();
    const { value = null, ...rest } = props;
    renderWithI18n(() => (
      <ComboboxField
        id="zone"
        label="Time zone"
        options={ZONES}
        value={value}
        onChange={onChange}
        {...rest}
      />
    ));
    const input = document.getElementById("zone");
    if (!(input instanceof HTMLInputElement)) throw new Error("no input with id zone");
    return { input, onChange };
  };

  const optionLabels = () => screen.queryAllByRole("option").map((o) => o.textContent.trim());

  it("TP-0b.6x: the label is associated with the input id", () => {
    const { input } = field();

    expect(screen.getByLabelText("Time zone", { selector: "input" })).toBe(input);
  });

  it("TP-0b.6x: typing filters by a case-insensitive substring of the label", async () => {
    const { input } = field();

    fireEvent.input(input, { target: { value: "ON" } });

    await waitFor(() => {
      expect(optionLabels().sort()).toEqual(["London"]);
    });

    fireEvent.input(input, { target: { value: "k" } });
    await waitFor(() => {
      expect(optionLabels().sort()).toEqual(["Kolkata", "New York"]);
    });
    expect(badClasses(document.body)).toEqual([]);
  });

  it("TP-0b.6x: choosing an option calls onChange with its value", async () => {
    const { input, onChange } = field();

    fireEvent.input(input, { target: { value: "cai" } });
    await waitFor(() => {
      expect(optionLabels()).toEqual(["Cairo"]);
    });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("Africa/Cairo");
    });
  });

  it("TP-0b.6x: choosing the selected option again clears it: onChange(null)", async () => {
    const [value, setValue] = createSignal<string | null>("Africa/Cairo");
    const onChange = vi.fn((v: string | null) => {
      setValue(v);
    });
    renderWithI18n(() => (
      <ComboboxField
        id="zone"
        label="Time zone"
        options={ZONES}
        value={value()}
        onChange={onChange}
      />
    ));
    const input = document.getElementById("zone") as HTMLInputElement;

    fireEvent.input(input, { target: { value: "cai" } });
    await waitFor(() => {
      expect(optionLabels()).toEqual(["Cairo"]);
    });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(null);
    });
  });

  it("TP-0b.6x: aria-describedby is zone-hint then zone-error; aria-invalid only with an error", () => {
    const { input } = field({
      hint: "Where you are most of the time.",
      error: "Choose a time zone.",
    });

    expect(input.getAttribute("aria-describedby")).toBe("zone-hint zone-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(document.getElementById("zone-hint")?.textContent).toBe(
      "Where you are most of the time.",
    );
    expect(document.getElementById("zone-error")?.textContent).toContain("Choose a time zone.");
  });

  it("TP-0b.6x: with neither hint nor error there is no aria-describedby or aria-invalid", () => {
    const { input } = field();

    expect(input.hasAttribute("aria-describedby")).toBe(false);
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
    expect(badClasses(document.body)).toEqual([]);
  });

  it("TP-0b.6x: with only a hint, aria-describedby is zone-hint and aria-invalid isn't set", () => {
    const { input } = field({ hint: "H" });

    expect(input.getAttribute("aria-describedby")).toBe("zone-hint");
    expect(input.getAttribute("aria-invalid")).not.toBe("true");
  });
});

describe("TP-0b.6x: RadioGroupField (P-A-515 (b))", () => {
  const OPTIONS = [
    { value: "system", label: "System" },
    { value: "light", label: "Light" },
    { value: "dark", label: "Dark" },
  ];

  it("TP-0b.6x: a radiogroup named by its label, one radio per option, the value checked", () => {
    const { container } = renderWithI18n(() => (
      <RadioGroupField
        id="appearance"
        label="Appearance"
        options={OPTIONS}
        value="light"
        onChange={() => undefined}
      />
    ));

    const group = screen.getByRole("radiogroup", { name: "Appearance" });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeTruthy();
    expect(radios).toHaveLength(3);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Light" }).checked).toBe(true);
    expect(screen.getByRole<HTMLInputElement>("radio", { name: "Dark" }).checked).toBe(false);
    expect(badClasses(container)).toEqual([]);
  });

  it("TP-0b.6x: choosing an option calls onChange with its value", async () => {
    const onChange = vi.fn<(v: string) => void>();
    renderWithI18n(() => (
      <RadioGroupField
        id="appearance"
        label="Appearance"
        options={OPTIONS}
        value="system"
        onChange={onChange}
      />
    ));

    fireEvent.click(screen.getByRole("radio", { name: "Dark" }));

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("dark");
    });
  });

  it("TP-0b.6x: aria-describedby is appearance-hint then appearance-error", () => {
    renderWithI18n(() => (
      <RadioGroupField
        id="appearance"
        label="Appearance"
        options={OPTIONS}
        value="system"
        onChange={() => undefined}
        hint="H"
        error="E"
      />
    ));

    const group = screen.getByRole("radiogroup", { name: "Appearance" });
    expect(group.getAttribute("aria-describedby")?.split(/\s+/)).toEqual([
      "appearance-hint",
      "appearance-error",
    ]);
  });

  it("TP-0b.6x: without hint or error there is no aria-describedby", () => {
    renderWithI18n(() => (
      <RadioGroupField
        id="appearance"
        label="Appearance"
        options={OPTIONS}
        value="system"
        onChange={() => undefined}
      />
    ));

    expect(
      screen.getByRole("radiogroup", { name: "Appearance" }).hasAttribute("aria-describedby"),
    ).toBe(false);
  });
});

describe("TP-0b.6x: SignedOutColumn (P-A-515 (c))", () => {
  it("TP-0b.6x: renders its children inside one column, with token classes only", () => {
    const { container } = renderWithI18n(() => (
      <SignedOutColumn>
        <h1>Sign in</h1>
        <p>Body</p>
      </SignedOutColumn>
    ));

    const heading = screen.getByRole("heading", { name: "Sign in" });
    const column = heading.parentElement;
    expect(column?.contains(screen.getByText("Body"))).toBe(true);
    expect(column?.getAttribute("class") ?? "").not.toBe("");
    expect(badClasses(container)).toEqual([]);
  });
});
