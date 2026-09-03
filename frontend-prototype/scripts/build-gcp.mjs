import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  ["node_modules/vite/bin/vite.js", "build"],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NITRO_PRESET: "node-server",
      WRANGLER_WRITE_LOGS: "false",
    },
  },
);
process.exitCode = result.status ?? 1;
