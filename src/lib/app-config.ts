// App config — local filesystem config is not used in cloud deployment.

export interface AppConfig {
  fc28HistoryPath: string;
}

export function readConfig(): AppConfig {
  return { fc28HistoryPath: "" };
}

export function writeConfig(_updates: Partial<AppConfig>): AppConfig {
  return { fc28HistoryPath: "" };
}
