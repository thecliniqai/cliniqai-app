import { getSystemDb } from "@/lib/supabase/system";

export default async function Page() {
  const { data } = await getSystemDb("api_v1").from("tenants").select("id");
  return <p>{data?.length}</p>;
}
