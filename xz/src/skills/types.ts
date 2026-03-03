/**
 * Skill types
 */

export interface Skill {
  name: string;
  description: string;
  argumentHint?: string;
  disableModelInvocation: boolean;
  content: string;
  source: string;  // File path
  priority: number;  // Higher = override lower
}

export interface SkillRegistry {
  get(name: string): Skill | undefined;
  list(): Skill[];
  load(): Promise<void>;
  reload(): Promise<void>;
}

export interface SkillLoaderOptions {
  agentsSkillsPath: string;
  claudeSkillsPath: string;
}
