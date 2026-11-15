// A-527: one section per shared component and state, for axe, contrast and forced-colours checks.
import { createSignal, type JSX } from "solid-js";
import { Button } from "../ui/Button.js";
import { CodeField } from "../ui/CodeField.js";
import { ComboboxField, type ComboboxOption } from "../ui/ComboboxField.js";
import { EmptyState } from "../ui/EmptyState.js";
import { PasswordField } from "../ui/PasswordField.js";
import { RadioGroupField } from "../ui/RadioGroupField.js";
import { SignedOutColumn } from "../ui/SignedOutColumn.js";
import { Skeleton } from "../ui/Skeleton.js";
import { TextField } from "../ui/TextField.js";
import { Wordmark } from "../ui/Wordmark.js";
import { useFixtureTitle } from "./title.js";

const OPTIONS: ComboboxOption[] = [
  { value: "eur", label: "Euro", group: "Europe" },
  { value: "gbp", label: "Pound sterling", group: "Europe" },
  { value: "usd", label: "US dollar", group: "Americas" },
];

const VARIANTS = ["primary", "secondary", "tertiary", "destructive"] as const;

/** [ownHeading]: the children already render the section's one h2. */
function Section(props: {
  name: string;
  ownHeading?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <section data-component={props.name} class="mt-8">
      {props.ownHeading === true ? null : (
        <h2 class="mb-3 text-lg font-semibold text-fg">{props.name}</h2>
      )}
      <div class="flex flex-col gap-4">{props.children}</div>
    </section>
  );
}

const noop = (): void => {};

export function ComponentsFixture(): JSX.Element {
  useFixtureTitle("Components");
  const [text, setText] = createSignal("");
  const [password, setPassword] = createSignal("");
  const [code, setCode] = createSignal("");
  const [recovery, setRecovery] = createSignal("");
  const [choice, setChoice] = createSignal<string | null>("usd");
  const [radio, setRadio] = createSignal("system");
  return (
    <>
      <h1 tabindex="-1" class="text-2xl font-semibold text-fg">
        Components
      </h1>
      <Section name="Button">
        {VARIANTS.map((variant) => (
          <div class="flex flex-wrap items-center gap-3">
            <Button variant={variant}>{variant}</Button>
            <Button variant={variant} size="compact">
              {variant} compact
            </Button>
          </div>
        ))}
        <div class="flex flex-wrap items-center gap-3">
          <Button variant="primary" icon="check">
            With icon
          </Button>
          <Button variant="primary" busy>
            Busy
          </Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
          <Button variant="secondary" href="/">
            Link
          </Button>
        </div>
      </Section>
      <Section name="TextField">
        <TextField id="cf-plain" label="Plain" value={text()} onInput={setText} />
        <TextField id="cf-hint" label="With a hint" hint="A short hint." value="" onInput={noop} />
        <TextField
          id="cf-error"
          label="With an error"
          error="Enter a value."
          value=""
          onInput={noop}
        />
        <TextField id="cf-email" label="Email" type="email" value="" onInput={noop} />
      </Section>
      <Section name="PasswordField">
        <PasswordField
          id="cf-password"
          label="Password"
          autocomplete="new-password"
          value={password()}
          onInput={setPassword}
        />
      </Section>
      <Section name="CodeField">
        <CodeField id="cf-code" label="Code" value={code()} onInput={setCode} />
        <CodeField
          id="cf-recovery"
          label="Recovery code"
          kind="text"
          value={recovery()}
          onInput={setRecovery}
        />
      </Section>
      <Section name="ComboboxField">
        <ComboboxField
          id="cf-combobox"
          label="Currency"
          options={OPTIONS}
          value={choice()}
          onChange={setChoice}
        />
      </Section>
      <Section name="RadioGroupField">
        <RadioGroupField
          id="cf-radio"
          label="Appearance"
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
          value={radio()}
          onChange={setRadio}
        />
      </Section>
      <Section name="EmptyState" ownHeading>
        <EmptyState
          icon="wallet"
          title="EmptyState"
          body="Add your first item to start."
          action={<Button variant="primary">Add item</Button>}
        />
      </Section>
      <Section name="Skeleton">
        <Skeleton rows={3} />
      </Section>
      <Section name="Wordmark">
        <Wordmark />
        <Wordmark href="/" />
      </Section>
      <Section name="Link">
        <p class="text-fg">
          An <a href="/">inline link</a> in a sentence.
        </p>
      </Section>
      <Section name="SignedOutColumn">
        <SignedOutColumn>
          <TextField id="cf-column" label="Email" type="email" value="" onInput={noop} />
          <div class="mt-4">
            <Button variant="primary" fullWidth>
              Continue
            </Button>
          </div>
        </SignedOutColumn>
      </Section>
    </>
  );
}
