import { promises as fs } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { defaultConfig, initConfigPath, saveConfig } from '../src/main/config.js';
import { initSkillsPath } from '../src/main/skills.js';
import { initDurableStore, resetDurableForTests } from '../src/main/durable.js';
import { initSessionStore, resetSessionStoreForTests } from '../src/main/session/store.js';
import { addProject } from '../src/main/projects.js';
import { prepareSessionPrompt } from '../src/main/session/prompt.js';
import { bindAgencyProfile, verifyAgencyProfileDirective } from '../src/main/agency-profile.js';
import { makeTempDir, removeTempDir } from './helpers.js';

let root: string;
let projectFolder: string;
let roleFile: string;
const initialSkill = '---\nname: agency-code-reviewer\ndescription: Inspect code independently\n---\n# Real catalog reviewer\nOnly report justified findings.\n';

beforeEach(async () => {
  root = await makeTempDir('cos-agency-profile-');
  initConfigPath(root); initDurableStore(root); initSessionStore(root);
  await saveConfig({ ...defaultConfig(), roots: [{ name: 'work', path: root }] });
  await initSkillsPath(root);
  projectFolder = path.join(root, 'project');
  roleFile = path.join(projectFolder, '.agents', 'skills', 'engineering-code-reviewer', 'SKILL.md');
  await fs.mkdir(path.dirname(roleFile), { recursive: true });
  await fs.writeFile(roleFile, initialSkill);
});
afterEach(async () => {
  resetSessionStoreForTests(); resetDurableForTests();
  await removeTempDir(root);
});

it('loads the exact project Agency profile and its SHA-256 in the real worker opening prompt', async () => {
  const binding = await bindAgencyProfile('engineering-code-reviewer', projectFolder);
  expect(binding.path).toContain('/.agents/skills/engineering-code-reviewer/SKILL.md');
  const project = await addProject(projectFolder);
  const authored = `/${binding.skillId}\n<!-- cos-agency:${binding.skillId}:${binding.sha256} -->\nReview only the changed files.`;
  const prompt = await prepareSessionPrompt(authored, { projectId: project.id });
  expect(prompt).toContain(`# Selected skill: /${binding.skillId}`);
  expect(prompt).toContain('Only report justified findings.');
  expect(prompt).toContain(binding.path);
});

it('refuses a changed catalog revision rather than sending a stale identity', async () => {
  const binding = await bindAgencyProfile('engineering-code-reviewer', projectFolder);
  const project = await addProject(projectFolder);
  const authored = `/${binding.skillId}\n<!-- cos-agency:${binding.skillId}:${binding.sha256} -->\nReview.`;
  await fs.writeFile(roleFile, initialSkill + 'Unreviewed replacement.\n');
  await expect(prepareSessionPrompt(authored, { projectId: project.id })).rejects.toThrow(/AGENCY_PROFILE_CHANGED/);
});

it('refuses absent roles, path traversal and mismatched selected identities', async () => {
  await expect(bindAgencyProfile('engineering-not-installed', projectFolder)).rejects.toThrow();
  await expect(bindAgencyProfile('../engineering-code-reviewer', projectFolder)).rejects.toThrow(/AGENCY_PROFILE_INVALID/);
  expect(() => verifyAgencyProfileDirective('/one\n<!-- cos-agency:two:' + 'a'.repeat(64) + ' -->\nTask', []))
    .toThrow(/AGENCY_PROFILE_MISMATCH/);
});
