import { serverEnv } from "@/lib/env-server";
export const joined = serverEnv()[["SUPABASE", "SECRET", "KEY"].join("_") as "NODE_ENV"];
export const concatenated = serverEnv()[("SUPABASE_" + "SECRET_KEY") as "NODE_ENV"];
const env = serverEnv();
const name = ["NODE", "ENV"].join("_") as "NODE_ENV";
export const viaVariable = env[name];
export const { [name]: destructured } = serverEnv();
export const enumerated = Object.values(serverEnv());
export const spread = { ...serverEnv() };
