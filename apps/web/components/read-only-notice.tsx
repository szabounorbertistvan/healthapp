/** The line above an editor the reader may look at but no longer change. */
export function ReadOnlyNotice({ text }: { text: string }) {
  return (
    <p role="status" data-testid="read-only-notice" className="mt-4 rounded-2xl bg-warn-soft px-4 py-3 text-[13px] font-semibold text-warn">
      {text}
    </p>
  );
}
