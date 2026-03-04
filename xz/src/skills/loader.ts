/**
 * Skill loader - loads skills from ~/.xz/skills, ~/.agents/skills and project .agents/skills
 */

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { getXZHome } from '../config/index.js';
import type { Skill, SkillLoaderOptions } from './types.js';

const DEFAULT_OPTIONS: SkillLoaderOptions = {
  xzSkillsPath: join(getXZHome(), 'skills'),
  homeAgentsSkillsPath: join(homedir(), '.agents', 'skills'),
  projectAgentsSkillsPath: join(process.cwd(), '.agents', 'skills'),
  legacyClaudeSkillsPath: join(homedir(), '.claude', 'skills'),
};

/**
 * Load all skills from configured paths
 */
export async function loadSkills(options: Partial<SkillLoaderOptions> = {}): Promise<Skill[]> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const skills: Map<string, Skill> = new Map();

  // Legacy compatibility with historical ~/.claude/skills location (lowest priority)
  if (opts.legacyClaudeSkillsPath && existsSync(opts.legacyClaudeSkillsPath)) {
    const legacySkills = await loadFromDirectory(opts.legacyClaudeSkillsPath, 40);
    for (const skill of legacySkills) {
      skills.set(skill.name, skill);
    }
  }

  // Load ~/.xz/skills
  if (existsSync(opts.xzSkillsPath)) {
    const xzSkills = await loadFromDirectory(opts.xzSkillsPath, 60);
    for (const skill of xzSkills) {
      skills.set(skill.name, skill);
    }
  }

  // Load ~/.agents/skills
  if (existsSync(opts.homeAgentsSkillsPath)) {
    const agentsHomeSkills = await loadFromDirectory(opts.homeAgentsSkillsPath, 80);
    for (const skill of agentsHomeSkills) {
      skills.set(skill.name, skill);
    }
  }

  // Load project-local .agents/skills (highest priority)
  if (existsSync(opts.projectAgentsSkillsPath)) {
    const agentsSkills = await loadFromDirectory(opts.projectAgentsSkillsPath, 100);
    for (const skill of agentsSkills) {
      skills.set(skill.name, skill);
    }
  }

  return Array.from(skills.values());
}

/**
 * Load skills from a directory
 */
async function loadFromDirectory(dir: string, priority: number): Promise<Skill[]> {
  const skills: Skill[] = [];

  if (!existsSync(dir)) {
    return skills;
  }

  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillDir = join(dir, entry.name);
    const skillFile = join(skillDir, 'SKILL.md');

    if (!existsSync(skillFile)) continue;

    try {
      const content = readFileSync(skillFile, 'utf-8');
      const skill = parseSkill(content, skillFile, priority);
      skills.push(skill);
    } catch (error) {
      console.warn(`Failed to load skill from ${skillFile}:`, error);
    }
  }

  return skills;
}

/**
 * Parse a SKILL.md file
 */
function parseSkill(content: string, source: string, priority: number): Skill {
  const lines = content.split('\n');
  
  // Parse frontmatter (simple YAML-like)
  const frontmatter: Record<string, string> = {};
  let i = 0;
  
  // Skip leading whitespace
  while (i < lines.length && lines[i].trim() === '') i++;
  
  // Check for ---
  if (lines[i]?.trim() === '---') {
    i++;
    while (i < lines.length && lines[i].trim() !== '---') {
      const line = lines[i];
      const colonIndex = line.indexOf(':');
      if (colonIndex > 0) {
        const key = line.slice(0, colonIndex).trim();
        const value = line.slice(colonIndex + 1).trim();
        frontmatter[key] = value;
      }
      i++;
    }
    i++; // Skip closing ---
  }

  // Rest is content
  const skillContent = lines.slice(i).join('\n').trim();

  return {
    name: frontmatter.name || 'unnamed',
    description: frontmatter.description || '',
    argumentHint: frontmatter['argument-hint'],
    disableModelInvocation: frontmatter['disable-model-invocation'] === 'true',
    content: skillContent,
    source,
    priority,
  };
}
