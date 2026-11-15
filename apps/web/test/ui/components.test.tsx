// P-A-513 (4), P-A-515: the shared web components (guide §2.1, §7 to §9). TP-0b.6, plus extra cases
// TP-0b.6x. IDs ending in "x" are test-architect additions, not LLD test-plan IDs.
//
// Shapes per P-A-515: one module per component, apps/web/src/ui/<Name>.tsx exporting <Name>;
// callers pass translated strings.
import { fireEvent, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";
import { APP_NAME } from "../../src/app/brand.js";
import { Button } from "../../src/ui/Button.js";
import { CodeField } from "../../src/ui/CodeField.js";
import { EmptyState } from "../../src/ui/EmptyState.js";
import { PasswordField } from "../../src/ui/PasswordField.js";
import { TextField } from "../../src/ui/TextField.js";
import { Wordmark } from "../../src/ui/Wordmark.js";
import { renderWithI18n } from "../support/render.js";
import { badClasses } from "../support/tokenClasses.js";

// P-A-515 (e) "token utilities only": badClasses (test/support/tokenClasses.ts).

// F-215 registry path data, to recognise icons.
const REFRESH_PATH = "M21 3v5h-5";
const CHECK_PATH = "M20 6 9 17l-5-5";
const hasPath = (el: Element, d: string) => el.querySelector(`svg path[d="${d}"]`) !== null;
/** The svg drawing path `d` inside `el`, or null. */
const svgWith = (el: Element, d: string) =>
  el.querySelector(`svg path[d="${d}"]`)?.closest("svg") ?? null;
/** A-515 (a), A-519: the busy icon spins through `animate-spin`. */
const spins = (svg: Element | null) => svg?.classList.contains("animate-spin") ?? false;

describe("TP-0b.6x: the class rule itself", () => {
  it("TP-0b.6x: palette and arbitrary colours are caught; tokens and non-colour arbitrary values pass", () => {
    const el = document.createElement("div");
    el.innerHTML =
      '<span class="bg-accent text-on-accent border-line-strong max-w-[26.25rem] hover:bg-accent-hover"></span>';
    expect(badClasses(el)).toEqual([]);

    el.innerHTML =
      '<span class="bg-gray-900 hover:border-sky-700 text-white text-[#fff] bg-[rgb(0,0,0)]"></span>';
    expect(badClasses(el)).toEqual([
      "bg-gray-900",
      "hover:border-sky-700",
      "text-white",
      "text-[#fff]",
      "bg-[rgb(0,0,0)]",
    ]);
  });
});

describe("TP-0b.6: Button", () => {
  it.each(["primary", "secondary", "tertiary", "destructive"] as const)(
    "TP-0b.6: the %s variant is a <button type=button> with its label and token classes only",
    (variant) => {
      const { container } = renderWithI18n(() => <Button variant={variant}>Save</Button>);

      const button = screen.getByRole("button", { name: "Save" });
      expect(button.tagName).toBe("BUTTON");
      expect(button.getAttribute("type")).toBe("button");
      expect(badClasses(container)).toEqual([]);
    },
  );

  it("TP-0b.6: the compact size and fullWidth render with token classes only", () => {
    const { container } = renderWithI18n(() => (
      <Button variant="secondary" size="compact" fullWidth>
        Sign out
      </Button>
    ));

    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(badClasses(container)).toEqual([]);
  });

  it("TP-0b.6: busy sets aria-busy, isn't disabled, ignores a click, keeps the label, and shows the spinning refresh icon in place of icon", () => {
    const onClick = vi.fn();
    renderWithI18n(() => (
      <Button variant="primary" icon="check" busy onClick={onClick}>
        Try again
      </Button>
    ));
    const button = screen.getByRole("button", { name: "Try again" });

    fireEvent.click(button);

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
    expect(button.textContent).toContain("Try again");
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(spins(svgWith(button, REFRESH_PATH))).toBe(true);
    expect(hasPath(button, CHECK_PATH)).toBe(false);
    for (const svg of button.querySelectorAll("svg")) {
      expect(svg.getAttribute("aria-hidden")).toBe("true");
    }
  });

  it("TP-0b.6x (A-515 (a), A-519): busy without an icon shows the one spinning refresh icon", () => {
    renderWithI18n(() => (
      <Button variant="primary" busy>
        Save
      </Button>
    ));
    const button = screen.getByRole("button", { name: "Save" });

    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(spins(svgWith(button, REFRESH_PATH))).toBe(true);
  });

  it('TP-0b.6x (A-515 (a), A-519): icon="refresh" shows one still refresh icon, which spins only while busy', () => {
    const [busy, setBusy] = createSignal(false);
    renderWithI18n(() => (
      <Button variant="primary" icon="refresh" busy={busy()}>
        Try again
      </Button>
    ));
    const button = screen.getByRole("button", { name: "Try again" });

    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(spins(svgWith(button, REFRESH_PATH))).toBe(false);

    setBusy(true);
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(spins(svgWith(button, REFRESH_PATH))).toBe(true);

    setBusy(false);
    expect(button.querySelectorAll("svg")).toHaveLength(1);
    expect(spins(svgWith(button, REFRESH_PATH))).toBe(false);
  });

  it("TP-0b.6: a busy submit button doesn't submit its form", () => {
    const onSubmit = vi.fn((e: SubmitEvent) => {
      e.preventDefault();
    });
    renderWithI18n(() => (
      <form onSubmit={onSubmit}>
        <Button variant="primary" type="submit" busy>
          Sign in
        </Button>
      </form>
    ));
    const button = screen.getByRole("button", { name: "Sign in" });

    expect(button.getAttribute("type")).toBe("submit");
    fireEvent.click(button);

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("TP-0b.6x: a submit button that isn't busy submits its form, and onClick is called", () => {
    const onSubmit = vi.fn((e: SubmitEvent) => {
      e.preventDefault();
    });
    const onClick = vi.fn();
    renderWithI18n(() => (
      <form onSubmit={onSubmit}>
        <Button variant="primary" type="submit" onClick={onClick}>
          Sign in
        </Button>
      </form>
    ));

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("TP-0b.6x: busy toggling back to false restores clicks and the icon", () => {
    const onClick = vi.fn();
    const [busy, setBusy] = createSignal(true);
    renderWithI18n(() => (
      <Button variant="primary" icon="check" busy={busy()} onClick={onClick}>
        Save
      </Button>
    ));
    const button = screen.getByRole("button", { name: "Save" });

    setBusy(false);
    fireEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(button.getAttribute("aria-busy")).not.toBe("true");
    expect(hasPath(button, CHECK_PATH)).toBe(true);
    expect(spins(svgWith(button, CHECK_PATH))).toBe(false);
    expect(hasPath(button, REFRESH_PATH)).toBe(false);
  });

  it("TP-0b.6x: the icon is at the inline start, before the label", () => {
    renderWithI18n(() => (
      <Button variant="secondary" icon="check">
        Copy
      </Button>
    ));
    const button = screen.getByRole("button", { name: "Copy" });

    const svg = button.querySelector("svg");
    expect(svg).not.toBeNull();
    const firstElement = button.firstElementChild;
    expect(firstElement === svg || (firstElement?.contains(svg) ?? false)).toBe(true);
  });

  it("TP-0b.6x: disabled sets the disabled attribute", () => {
    renderWithI18n(() => (
      <Button variant="primary" disabled>
        Send
      </Button>
    ));

    expect(screen.getByRole("button", { name: "Send" }).hasAttribute("disabled")).toBe(true);
  });

  it("TP-0b.6: href renders an <a href> with the same classes as the button", () => {
    const { container } = renderWithI18n(() => (
      <>
        <Button variant="secondary" href="/">
          Go to home
        </Button>
        <Button variant="secondary">Go to home</Button>
      </>
    ));

    const link = screen.getByRole("link", { name: "Go to home" });
    const button = screen.getByRole("button", { name: "Go to home" });
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/");
    expect(link.hasAttribute("type")).toBe(false);
    const classes = (el: Element) => (el.getAttribute("class") ?? "").split(/\s+/).sort();
    expect(classes(link)).toEqual(classes(button));
    expect(badClasses(container)).toEqual([]);
  });
});

describe("TP-0b.6: TextField", () => {
  const field = (props: { hint?: string; error?: string }) => {
    const onInput = vi.fn<(v: string) => void>();
    const result = renderWithI18n(() => (
      <TextField id="email" label="Email" value="" onInput={onInput} {...props} />
    ));
    return { ...result, onInput, input: screen.getByLabelText("Email") };
  };

  it("TP-0b.6: with neither hint nor error: the label is for the input; no aria-describedby, no aria-invalid", () => {
    const { input, container } = field({});

    expect(input.id).toBe("email");
    expect(container.querySelector('label[for="email"]')?.textContent).toBe("Email");
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    expect(input.hasAttribute("aria-invalid")).toBe(false);
    expect(badClasses(container)).toEqual([]);
  });

  it("TP-0b.6: with a hint: aria-describedby is email-hint, which holds the hint", () => {
    const { input, container } = field({ hint: "We'll send the link here." });

    expect(input.getAttribute("aria-describedby")).toBe("email-hint");
    expect(container.querySelector("p#email-hint")?.textContent).toBe("We'll send the link here.");
    expect(input.hasAttribute("aria-invalid")).toBe(false);
  });

  it("TP-0b.6: with an error: aria-invalid and aria-describedby email-error, which holds the message", () => {
    const { input, container } = field({ error: "Enter an email address." });

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("email-error");
    expect(container.querySelector("#email-error")?.textContent).toContain(
      "Enter an email address.",
    );
  });

  it("TP-0b.6: with both: aria-describedby is 'email-hint email-error' in that order", () => {
    const { input } = field({ hint: "H", error: "E" });

    expect(input.getAttribute("aria-describedby")).toBe("email-hint email-error");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("TP-0b.6x: typing calls onInput with the value", () => {
    const { input, onInput } = field({});

    fireEvent.input(input, { target: { value: "mona@example.com" } });

    expect(onInput).toHaveBeenLastCalledWith("mona@example.com");
  });

  it('TP-0b.6x: type="email" adds dir="ltr"; the default text type has no dir', () => {
    renderWithI18n(() => (
      <>
        <TextField id="a" label="A" value="" onInput={() => undefined} type="email" />
        <TextField id="b" label="B" value="" onInput={() => undefined} />
      </>
    ));

    expect(screen.getByLabelText("A").getAttribute("dir")).toBe("ltr");
    expect(screen.getByLabelText("A").getAttribute("type")).toBe("email");
    expect(screen.getByLabelText("B").hasAttribute("dir")).toBe(false);
  });
});

describe("TP-0b.6: PasswordField", () => {
  const field = () => {
    renderWithI18n(() => (
      <PasswordField
        id="password"
        label="Password"
        value="secret"
        onInput={() => undefined}
        autocomplete="current-password"
      />
    ));
    return {
      input: screen.getByLabelText("Password", { selector: "input" }),
      toggle: screen.getByRole("button", { name: "Show password" }),
    };
  };

  it("TP-0b.6 (A-29, A-520): clicking the toggle: 'Show'/'Show password' becomes 'Hide'/'Hide password', no aria-pressed, the input becomes text and keeps focus", () => {
    const { input, toggle } = field();
    input.focus();

    expect(toggle.getAttribute("type")).toBe("button");
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
    expect(toggle.textContent).toContain("Show");
    expect(toggle.textContent).not.toContain("Hide");
    expect(input.getAttribute("type")).toBe("password");

    const pointerDownNotPrevented = fireEvent.pointerDown(toggle);
    fireEvent.click(toggle);

    expect(pointerDownNotPrevented).toBe(false);
    expect(document.activeElement).toBe(input);
    expect(screen.getByRole("button", { name: "Hide password" })).toBe(toggle);
    expect(screen.queryByRole("button", { name: "Show password" })).toBeNull();
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
    expect(toggle.textContent).toContain("Hide");
    expect(toggle.textContent).not.toContain("Show");
    expect(input.getAttribute("type")).toBe("text");
  });

  it("TP-0b.6 (A-29, A-520): by keyboard: the focused native button toggles to 'Hide password' and back, never sets aria-pressed, and keeps focus", () => {
    const { input, toggle } = field();

    expect(toggle.tagName).toBe("BUTTON");
    expect(toggle.getAttribute("tabindex")).not.toBe("-1");
    toggle.focus();
    expect(document.activeElement).toBe(toggle);

    toggle.click();
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByRole("button", { name: "Hide password" })).toBe(toggle);
    expect(toggle.textContent).toContain("Hide");
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
    expect(input.getAttribute("type")).toBe("text");

    toggle.click();
    expect(document.activeElement).toBe(toggle);
    expect(screen.getByRole("button", { name: "Show password" })).toBe(toggle);
    expect(toggle.textContent).toContain("Show");
    expect(toggle.textContent).not.toContain("Hide");
    expect(toggle.hasAttribute("aria-pressed")).toBe(false);
    expect(input.getAttribute("type")).toBe("password");
  });

  it("TP-0b.6x: autocomplete is passed to the input", () => {
    const { input } = field();

    expect(input.getAttribute("autocomplete")).toBe("current-password");
  });
});

describe("TP-0b.6: CodeField", () => {
  it('TP-0b.6: the numeric kind (the default) has dir="ltr", inputmode numeric and autocomplete one-time-code', () => {
    renderWithI18n(() => <CodeField id="code" label="Code" value="" onInput={() => undefined} />);
    const input = screen.getByLabelText("Code");

    expect(input.getAttribute("dir")).toBe("ltr");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
  });

  it('TP-0b.6: the text kind has dir="ltr", inputmode text, autocomplete off and autocapitalize characters', () => {
    renderWithI18n(() => (
      <CodeField id="rc" label="Recovery code" value="" onInput={() => undefined} kind="text" />
    ));
    const input = screen.getByLabelText("Recovery code");

    expect(input.getAttribute("dir")).toBe("ltr");
    expect(input.getAttribute("inputmode")).toBe("text");
    expect(input.getAttribute("autocomplete")).toBe("off");
    expect(input.getAttribute("autocapitalize")).toBe("characters");
  });

  it("TP-0b.6x: an error sets aria-invalid and aria-describedby code-error", () => {
    renderWithI18n(() => (
      <CodeField id="code" label="Code" value="" onInput={() => undefined} error="Wrong code." />
    ));
    const input = screen.getByLabelText("Code");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toBe("code-error");
  });
});

describe("TP-0b.6: EmptyState", () => {
  it.each([
    [1, "H1"],
    [2, "H2"],
  ] as const)(
    "TP-0b.6: headingLevel %d renders an %s; the icon is aria-hidden; body and action are shown",
    (level, tag) => {
      const { container } = renderWithI18n(() => (
        <EmptyState
          icon="check"
          title="No accounts yet"
          body="Add your first account to start."
          headingLevel={level}
          action={<button type="button">Add account</button>}
        />
      ));

      const heading = screen.getByRole("heading", { name: "No accounts yet" });
      expect(heading.tagName).toBe(tag);
      expect(screen.getByText("Add your first account to start.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add account" })).toBeTruthy();
      const svgs = [...container.querySelectorAll("svg")];
      expect(svgs.length).toBeGreaterThan(0);
      for (const svg of svgs) expect(svg.closest('[aria-hidden="true"]')).not.toBeNull();
      expect(badClasses(container)).toEqual([]);
    },
  );

  it("TP-0b.6x: without headingLevel the heading is an h2, and without action there is no button", () => {
    renderWithI18n(() => <EmptyState icon="check" title="Nothing yet" body="Start here." />);

    expect(screen.getByRole("heading", { name: "Nothing yet" }).tagName).toBe("H2");
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("TP-0b.6: Wordmark", () => {
  /** The wordmark's text split by whether it sits inside the accent element, empty text dropped. */
  const parts = (root: Element, accent: Element) => {
    const out: { text: string; accent: boolean }[] = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
      const text = n.textContent ?? "";
      if (text === "") continue;
      const inAccent = accent.contains(n);
      const last = out.at(-1);
      if (last?.accent === inAccent) last.text += text;
      else out.push({ text, accent: inAccent });
    }
    return out;
  };

  /** A-523: one accent span holding "D" alone, "w" and "it" outside it, the parts joining to APP_NAME. */
  const expectMark = (root: Element) => {
    expect(root.textContent).toBe("wDit");
    expect(root.getAttribute("dir")).toBe("ltr");
    expect(root.hasAttribute("aria-label")).toBe(false);
    expect(root.querySelector("[aria-label]")).toBeNull();
    expect(root.classList.contains("font-semibold")).toBe(true);
    expect(root.classList.contains("text-[1.25rem]")).toBe(true);

    const accents = root.querySelectorAll(".text-accent-fg");
    expect(accents).toHaveLength(1);
    const accent = accents[0];
    expect(accent?.tagName).toBe("SPAN");
    expect(accent?.hasAttribute("role")).toBe(false);
    expect(accent?.textContent).toBe("D");

    const split = parts(root, accent as Element);
    expect(split).toEqual([
      { text: "w", accent: false },
      { text: "D", accent: true },
      { text: "it", accent: false },
    ]);
    expect(split.map((p) => p.text).join("")).toBe(APP_NAME);
  };

  it('TP-0b.6 (A-33, A-523): without href it is a <span dir="ltr"> reading wDit, with the "D" alone in the accent span, and no link', () => {
    const { container } = renderWithI18n(() => <Wordmark />);

    const root = container.firstElementChild as Element;
    expect(container.children).toHaveLength(1);
    expect(root.tagName).toBe("SPAN");
    expect(screen.queryByRole("link")).toBeNull();
    expectMark(root);
    expect(badClasses(container)).toEqual([]);
  });

  it('TP-0b.6 (A-33, A-523): with href="/" it is an <a href="/"> whose accessible name is the visible wDit', () => {
    const { container } = renderWithI18n(() => <Wordmark href="/" />);

    const link = screen.getByRole("link", { name: "wDit" });
    expect(container.firstElementChild).toBe(link);
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/");
    expectMark(link);
    expect(badClasses(container)).toEqual([]);
  });
});
