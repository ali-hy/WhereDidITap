// /__fixtures/kobalte-spike (A-331, DV-3): a dialog, a combobox, a date field and a menu, driven
// by keyboard in TP-11.28.
import { Combobox } from "@kobalte/core/combobox";
import { Dialog } from "@kobalte/core/dialog";
import { DropdownMenu } from "@kobalte/core/dropdown-menu";
import { TextField } from "@kobalte/core/text-field";
import { createSignal, type JSX } from "solid-js";

const CURRENCIES = ["USD", "EUR", "EGP"];

export function KobalteSpikeFixture(): JSX.Element {
  const [picked, setPicked] = createSignal("");
  return (
    <>
      <h1 tabindex="-1">Kobalte spike</h1>

      <Dialog>
        <Dialog.Trigger class="focus-visible:outline">Open dialog</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay class="fixed inset-0 bg-black/30" />
          <Dialog.Content class="fixed inset-x-4 top-16 rounded bg-white p-4">
            <Dialog.Title>Spike dialog</Dialog.Title>
            <Dialog.CloseButton class="focus-visible:outline" aria-label="Close">
              Close
            </Dialog.CloseButton>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>

      <Combobox
        options={CURRENCIES}
        placeholder="Choose"
        itemComponent={(props) => (
          <Combobox.Item item={props.item}>
            <Combobox.ItemLabel>{props.item.rawValue}</Combobox.ItemLabel>
          </Combobox.Item>
        )}
      >
        <Combobox.Label>Currency</Combobox.Label>
        <Combobox.Control aria-label="Currency">
          <Combobox.Input class="focus-visible:outline" />
          <Combobox.Trigger aria-label="Show currencies" />
        </Combobox.Control>
        <Combobox.Portal>
          <Combobox.Content>
            <Combobox.Listbox />
          </Combobox.Content>
        </Combobox.Portal>
      </Combobox>

      <TextField>
        <TextField.Label>Date</TextField.Label>
        <TextField.Input type="date" class="focus-visible:outline" />
      </TextField>

      <DropdownMenu>
        <DropdownMenu.Trigger class="focus-visible:outline">Actions</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content class="rounded bg-white p-1 shadow">
            <DropdownMenu.Item class="focus-visible:outline" onSelect={() => setPicked("Rename")}>
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Item class="focus-visible:outline" onSelect={() => setPicked("Delete")}>
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu>
      <p role="status">{picked() === "" ? "" : `Picked: ${picked()}`}</p>
    </>
  );
}
