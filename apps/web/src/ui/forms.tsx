// F-213: form error helpers (J-2).
import type { MessageDescriptor } from "@formatjs/intl";
import { createEffect, For, on, Show, type JSX } from "solid-js";
import { messages } from "../i18n/messages.js";
import { Icon } from "./icons/Icon.js";

export interface Issue {
  code: string;
  path: readonly (string | number)[];
  message: string;
}

type Translate = (d: MessageDescriptor, v?: Record<string, unknown>) => string;
type SummaryEntry = { fieldId?: string; text: string };

/** An icon and the message; the id is the input's aria-describedby target. */
export function FieldError(props: { id: string; message?: string | undefined }): JSX.Element {
  return (
    <p id={props.id} class="flex items-center gap-1">
      <Show when={props.message}>
        {(message) => (
          <>
            <Icon name="alert" />
            {message()}
          </>
        )}
      </Show>
    </p>
  );
}

/** role="alert", focused when its messages change; each entry links to its field. */
export function FormErrorSummary(props: { messages: readonly SummaryEntry[] }): JSX.Element {
  let el: HTMLDivElement | undefined;
  createEffect(
    on(
      () => props.messages,
      (list) => {
        if (list.length > 0) el?.focus();
      },
    ),
  );
  // A-399: nothing is rendered when every issue went to its field.
  return (
    <Show when={props.messages.length > 0}>
      <div ref={el} role="alert" tabindex="-1">
        <ul>
          <For each={props.messages}>
            {(m) => (
              <li>
                <Show when={m.fieldId} fallback={m.text}>
                  {(fieldId) => <a href={`#${fieldId()}`}>{m.text}</a>}
                </Show>
              </li>
            )}
          </For>
        </ul>
      </div>
    </Show>
  );
}

const VALIDATION: Readonly<Record<string, MessageDescriptor>> = {
  invalid_type: messages.validationInvalidType,
  too_small: messages.validationTooSmall,
  too_big: messages.validationTooBig,
  invalid_format: messages.validationInvalidFormat,
  unrecognized_keys: messages.validationUnrecognizedKeys,
};

/**
 * Field issues go to their fields (A-399). When every issue names a field there's no summary and
 * the first invalid field in DOM order takes focus; otherwise the summary (the form message plus
 * the unmapped issues) appears and takes focus.
 */
export function applyServerIssues(
  issues: readonly Issue[],
  fields: Readonly<Record<string, { id: string; label: string; setError: (m: string) => void }>>,
  t: Translate,
): { summary: SummaryEntry[]; focus: { fieldId: string } | "summary" } {
  const unmapped: SummaryEntry[] = [];
  const invalid: string[] = [];
  const message = (issue: Issue) => t(VALIDATION[issue.code] ?? messages.validationInvalid);
  for (const issue of issues) {
    // A-460 (1): a form-level issue is a summary entry with its own message.
    if (issue.path.length === 0) {
      unmapped.push({ text: message(issue) });
      continue;
    }
    const key = fieldKeyFor(issue.path, fields);
    if (key === undefined) {
      unmapped.push({
        text: t(messages.errorValidationUnknownField, { label: issue.path.join(".") }),
      });
      continue;
    }
    const field = fields[key];
    // A-460 (3): the first issue for a field sets its error; later ones are skipped.
    if (field === undefined || invalid.includes(field.id)) continue;
    field.setError(message(issue));
    invalid.push(field.id);
  }
  const first = firstInDocumentOrder(invalid);
  if (unmapped.length === 0 && first !== undefined) {
    document.getElementById(first)?.focus();
    return { summary: [], focus: { fieldId: first } };
  }
  return { summary: [{ text: t(messages.errorValidationForm) }, ...unmapped], focus: "summary" };
}

/** A-460 (2): the field whose key is the longest whole-segment prefix of `path`. */
function fieldKeyFor(
  path: Issue["path"],
  fields: Readonly<Record<string, unknown>>,
): string | undefined {
  const segments = path.map(String);
  for (let n = segments.length; n > 0; n -= 1) {
    const key = segments.slice(0, n).join(".");
    if (Object.hasOwn(fields, key)) return key;
  }
  return undefined;
}

/** The id whose element comes first in the document (ids without an element last). */
function firstInDocumentOrder(ids: readonly string[]): string | undefined {
  let first: { id: string; el: HTMLElement | null } | undefined;
  for (const id of ids) {
    const el = document.getElementById(id);
    if (first === undefined) {
      first = { id, el };
    } else if (
      el !== null &&
      (first.el === null ||
        (el.compareDocumentPosition(first.el) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0)
    ) {
      first = { id, el };
    }
  }
  return first?.id;
}
