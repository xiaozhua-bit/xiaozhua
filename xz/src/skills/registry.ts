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

    const availableSkills = [
      '<available_skills>',
      ...skills.map((skill) => {
        const location =
          skill.source !== 'builtin' && skill.source.trim().length > 0
            ? `\n    <location>${this.xmlEscape(skill.source)}</location>`
            : '';
        const argumentHint = skill.argumentHint
          ? `\n    <argument_hint>${this.xmlEscape(skill.argumentHint)}</argument_hint>`
          : '';
        const disableModelInvocation = skill.disableModelInvocation
          ? '\n    <disable_model_invocation>true</disable_model_invocation>'
          : '';

        return (
          '  <skill>\n' +
          `    <name>${this.xmlEscape(skill.name)}</name>\n` +
          `    <description>${this.xmlEscape(skill.description)}</description>` +
          argumentHint +
          disableModelInvocation +
          location +
          '\n  </skill>'
        );
      }),
      '</available_skills>',
    ].join('\n');

    return (
      `${availableSkills}\n\n` +
      'Only skill catalog entries are preloaded.\n' +
      'If you need full instructions for a skill, call tool `load_skill` with the exact skill name.\n' +
      'After loading, follow that skill content.'
    );
  }

  private xmlEscape(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
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
