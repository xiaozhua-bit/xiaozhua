/**
 * xz skill CLI commands
 */

import { Command } from 'commander';
import { getSkillRegistry, loadSkills, BUILTIN_SKILLS } from '../skills/index.js';

export function createSkillCommand(): Command {
  const skill = new Command('skill')
    .description('Skill management');

  // List command
  skill
    .command('list')
    .description('List available skills')
    .option('-v, --verbose', 'Show full skill content')
    .action(async (options) => {
      try {
        const registry = getSkillRegistry();
        await registry.load();

        // Also register builtins
        const { registerBuiltinSkills } = await import('../skills/builtin.js');
        registerBuiltinSkills(registry);

        const skills = registry.list();

        if (skills.length === 0) {
          console.log('No skills found.');
          return;
        }

        console.log(`Skills (${skills.length}):\n`);

        skills.forEach((s, i) => {
          const source = s.source.includes('builtin') ? 'builtin' : s.source;
          console.log(`${i + 1}. ${s.name} (priority: ${s.priority})`);
          console.log(`   Source: ${source}`);
          console.log(`   Description: ${s.description}`);
          
          if (s.argumentHint) {
            console.log(`   Usage: ${s.name} ${s.argumentHint}`);
          }

          if (options.verbose && s.content) {
            const preview = s.content.slice(0, 200).replace(/\n/g, ' ');
            console.log(`   Preview: ${preview}${s.content.length > 200 ? '...' : ''}`);
          }
          console.log('');
        });
      } catch (error) {
        console.error('List failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Show command
  skill
    .command('show')
    .description('Show a specific skill')
    .argument('<name>', 'Skill name')
    .action(async (name) => {
      try {
        const registry = getSkillRegistry();
        await registry.load();

        const { registerBuiltinSkills } = await import('../skills/builtin.js');
        registerBuiltinSkills(registry);

        const s = registry.get(name);
        if (!s) {
          console.error(`Skill not found: ${name}`);
          process.exit(1);
        }

        console.log(`# ${s.name}`);
        console.log(`Source: ${s.source}`);
        console.log(`Priority: ${s.priority}`);
        console.log(`Description: ${s.description}`);
        
        if (s.argumentHint) {
          console.log(`Usage: ${s.name} ${s.argumentHint}`);
        }

        console.log('\n---\n');
        console.log(s.content);
      } catch (error) {
        console.error('Show failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Reload command
  skill
    .command('reload')
    .description('Reload skills from disk')
    .action(async () => {
      try {
        const registry = getSkillRegistry();
        await registry.reload();
        
        const { registerBuiltinSkills } = await import('../skills/builtin.js');
        registerBuiltinSkills(registry);

        const skills = registry.list();
        console.log(`✓ Reloaded ${skills.length} skills`);
      } catch (error) {
        console.error('Reload failed:', error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Builtins command (debug)
  skill
    .command('builtins')
    .description('List built-in skills')
    .action(async () => {
      console.log('Built-in skills:\n');
      BUILTIN_SKILLS.forEach((s, i) => {
        console.log(`${i + 1}. ${s.name}`);
        console.log(`   ${s.description}\n`);
      });
    });

  return skill;
}
