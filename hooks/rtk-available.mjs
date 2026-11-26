// RTK ligado só vale se o executável estiver no PATH: ausente, nada é exigido.
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";

export const rtkEnabled = () => process.env.CLAUDE_PLUGIN_OPTION_RTK === "true";

export function rtkInstalled() {
  const names = process.platform === "win32" ? ["rtk.exe", "rtk.cmd", "rtk.bat"] : ["rtk"];
  const folders = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  return folders.some((folder) => names.some((name) => existsSync(join(folder, name))));
}

export const rtkActive = () => rtkEnabled() && rtkInstalled();
