/** A small "?" that shows `text` on hover (and to screen readers). Used next to anything non-obvious. */
export function Hint({ text }: { text: string }) {
  return (
    <span
      title={text}
      aria-label={text}
      role="img"
      className="ml-1 inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-current text-[10px] opacity-60"
    >
      ?
    </span>
  );
}
