// F-312: bidirectional isolation of embedded text.
export function isolate(text: string): string {
  return `⁨${text}⁩`;
}
