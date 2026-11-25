// Reescreve comandos de shell pelo RTK (ferramenta externa, instalada à parte).
import { spawnSync } from "node:child_process";

// Desligado por padrão: só age com a opção `rtk` do plugin ligada.
if (process.env.CLAUDE_PLUGIN_OPTION_RTK !== "true") process.exit(0);

spawnSync("rtk", ["hook", "claude"], { stdio: "inherit" });
