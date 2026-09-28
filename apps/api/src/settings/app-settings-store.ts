import fs from 'node:fs';
import path from 'node:path';
import { AppSettingsSchema, type AppSettings } from '@app/shared';
import { appConfig } from '../../../../config/app.config.js';

// data/app-settings.json holds the CURRENT live settings once the user has
// edited anything via the Settings page. config/app.config.ts's exported
// object is only ever the fallback default, used until that file exists.
// Same load/save-a-JSON-file pattern already proven for the LLM/video API
// key config in an earlier phase of this project.
export function createAppSettingsStore(dataDir: string) {
  const filePath = path.join(dataDir, 'app-settings.json');

  function load(): AppSettings {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return AppSettingsSchema.parse(JSON.parse(raw));
    } catch {
      // Missing file, corrupt JSON, or a shape that no longer matches the
      // schema -- fall back to defaults rather than crash the server.
      return AppSettingsSchema.parse(appConfig);
    }
  }

  function save(next: AppSettings): AppSettings {
    const validated = AppSettingsSchema.parse(next);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(validated, null, 2), 'utf-8');
    return validated;
  }

  return { load, save };
}

export type AppSettingsStore = ReturnType<typeof createAppSettingsStore>;
