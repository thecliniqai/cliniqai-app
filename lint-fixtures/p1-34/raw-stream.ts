import { stderr } from "node:process";

export function writeRaw(line: string) {
  process.stderr.write(line);
  process["stdout"].write(line);
  globalThis.process.stderr.write(line);
  const { stdout } = process;
  stdout.write(line);
  stderr.write(line);
  require("node:process").stdout.write(line);
}
