import { redirect } from "next/navigation";

/**
 * `/` is Today (V2-08 08-03b, R-14): the dashboard layout above has already signed the visitor in (no session: /login; no
 * clinic: /clinic/new; a locked clinic: its billing page), so this only sends them on. 307, so the PWA's start URL and old
 * bookmarks keep working while `/today` is the address everything links to.
 */
export default function Home() {
  redirect("/today");
}
