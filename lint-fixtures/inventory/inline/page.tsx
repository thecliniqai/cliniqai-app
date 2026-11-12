// Inventory-gate fixture (P0-13, V2-02 02-06 IR-F3): an inline (function-level) "use server" action in a page. Next
// exposes it as a server action endpoint, but the inventory reads only module-level directives, so it must be flagged.
// Never imported or rendered.
export default function InlineActionFixturePage() {
  async function saveNote(formData: FormData) {
    "use server";
    return formData.get("note");
  }
  return (
    <form action={async (fd: FormData) => { await saveNote(fd); }}>
      <input name="note" />
    </form>
  );
}
