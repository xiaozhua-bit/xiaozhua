/**
 * Skill registry - manages loaded skills
 */

import { loadSkills } from './loader.js';
import type { Skill, SkillRegistry, SkillLoaderOptions } from './types.js';

export class SimpleSkillRegistry implements SkillRegistry {
  private skills: Map<string, Skill> = new Map();
  private options: Partial<SkillLoaderOptions>;

  constructor(options: Partial<SkillLoaderOptions> = {}) {
    this.options = options;
  }

  /**
   * Load skills from disk
   */
  async load(): Promise<void> {
    const skills = await loadSkills(this.options);
    this.skills.clear();
    for (const skill of skills) {
      this.skills.set(skill.name, skill);
    }
  }

  /**
   * Reload skills from disk
   */
  async reload(): Promise<void> {
    await this.load();
  }

  /**
   * Get a skill by name
   */
  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  /**
   * List all skills
   */
  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Register a skill manually
   */
  register(skill: Skill): void {
    this.skills.set(skill.name, skill);
  }

  /**
   * Get skills formatted for system prompt
   */
  formatForPrompt(): string {
    const skills = this.list();
    if (skills.length === 0) {
      return '';
    }

    return skills.map(s => `
## ${s.name}
${s.description}
${s.argumentHint ? `Usage: ${s.name} ${s.argumentHint}` : ''}
${s.content}
`).join('\n---\n');
  }
}

// Global registry instance
let globalRegistry: SimpleSkillRegistry | null = null;

/**
 * Get or create the global skill registry
 */
export function getSkillRegistry(options?: Partial<SkillLoaderOptions>): SimpleSkillRegistry {
  if (!globalRegistry) {
    globalRegistry = new SimpleSkillRegistry(options);
  }
  return globalRegistry;
}

/**
 * Reset the global registry (for testing)
 */
export function resetSkillRegistry(): void {
  globalRegistry = null;
}
