// eslint-disable-next-line @typescript-eslint/no-restricted-imports
import { getSystemDb } from "@/lib/supabase/system";
/* eslint no-restricted-syntax: "off" */
/* eslint-disable */
export const db = () => getSystemDb("api_v1");
