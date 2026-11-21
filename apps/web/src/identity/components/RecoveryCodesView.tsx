// F-165: the recovery codes, shown once; used by the setup page and S-10's regeneration dialog.
import { createSignal, For, Show, type JSX } from "solid-js";
import { useI18n } from "../../i18n/useI18n.js";
import { Button } from "../../ui/Button.js";
import { showToast } from "../../ui/Toaster.js";
import { FormErrorSummary } from "../../ui/forms.js";
import { identityMessages as m } from "../messages.js";

const FILE_NAME = "budmon-recovery-codes.txt";

export interface RecoveryCodesViewProps {
  codes: readonly string[];
  /** Text above the codes. */
  notice?: string;
  /** A failure of Done, shown above the buttons. */
  summary?: { text: string }[];
  busy: boolean;
  /** Runs when Done is pressed (after the box is ticked). */
  onDone: () => void;
}

export function RecoveryCodesView(props: RecoveryCodesViewProps): JSX.Element {
  const { t } = useI18n();
  const [saved, setSaved] = createSignal(false);

  const copyAll = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(props.codes.join("\n"));
      showToast({ tone: "success", message: t(m.twostepCopied) });
    } catch {
      // Clipboard blocked: the codes stay on screen to select by hand.
    }
  };

  const download = (): void => {
    const url = URL.createObjectURL(
      new Blob([`${props.codes.join("\n")}\n`], { type: "text/plain" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = FILE_NAME;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div class="flex flex-col gap-4">
      <Show when={props.notice}>{(text) => <p class="text-fg">{text()}</p>}</Show>
      <p class="text-fg">{t(m.twostepCodesBody)}</p>
      <ul class="grid grid-cols-1 gap-2 rounded-control border border-line bg-surface-sunken p-4 min-[420px]:grid-cols-2">
        <For each={props.codes}>
          {(code) => (
            <li dir="ltr" class="font-mono text-lg tracking-wider text-fg">
              {code}
            </li>
          )}
        </For>
      </ul>
      <FormErrorSummary messages={props.summary ?? []} />
      <div class="flex flex-wrap gap-2" data-button-row>
        <Button variant="secondary" onClick={() => void copyAll()}>
          {t(m.twostepCodesCopy)}
        </Button>
        <Button variant="secondary" onClick={download}>
          {t(m.twostepCodesDownload)}
        </Button>
      </div>
      <label class="flex items-center gap-2 text-fg">
        <input
          type="checkbox"
          class="size-5"
          checked={saved()}
          onChange={(e) => {
            setSaved(e.currentTarget.checked);
          }}
        />
        {t(m.twostepCodesAck)}
      </label>
      <div data-button-row>
        <Button variant="primary" busy={props.busy} disabled={!saved()} onClick={props.onDone}>
          {t(m.twostepCodesDone)}
        </Button>
      </div>
    </div>
  );
}
