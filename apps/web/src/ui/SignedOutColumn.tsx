// P-A-515 (c): the signed-out column (UX guide §5.2): 420 px wide, on a card from 600 px.
import type { JSX } from "solid-js";

export interface SignedOutColumnProps {
  children: JSX.Element;
}

export function SignedOutColumn(props: SignedOutColumnProps): JSX.Element {
  return (
    <div class="mx-auto mt-6 w-full max-w-[26.25rem] min-[600px]:mt-12 min-[600px]:rounded-card min-[600px]:border min-[600px]:border-line min-[600px]:bg-surface min-[600px]:p-8">
      {props.children}
    </div>
  );
}
