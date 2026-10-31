import path from 'node:path';
import { createHash } from 'node:crypto';
import { getConfig } from './config.js';
import { resolvePath } from './sandbox.js';
import { listSkillLibrary, readLibrarySkill } from './skill-library.js';

export interface AgencyProfileBinding {
  name: string;
  skillId: string;
  path: string;
  sha256: string;
}

const PROFILE_NAME = /^[a-z0-9][a-z0-9._-]{0,78}[a-z0-9]$/;

/** Bind only an actual selected project's Agency catalog skill, never a freeform persona. */
export async function bindAgencyProfile(name: string, projectPath: string): Promise<AgencyProfileBinding> {
  if (!PROFILE_NAME.test(name)) throw new Error('AGENCY_PROFILE_INVALID: use an installed Agency skill directory name.');
  const filename = path.join(projectPath, '.agents', 'skills', name, 'SKILL.md');
  const before = await resolvePath(getConfig().roots, filename);
  const library = await listSkillLibrary({ projectPath });
  const entry = library.skills.find(skill =>
    skill.source === 'repo-agents' && skill.path === before.virtual);
  if (!entry) throw new Error(`AGENCY_PROFILE_UNAVAILABLE: ${name} is not an installed project Agency catalog skill.`);
  const document = await readLibrarySkill(entry.id, { projectPath }, library);
  const after = await resolvePath(getConfig().roots, filename);
  if (before.real !== after.real || before.virtual !== after.virtual) {
    throw new Error('AGENCY_PROFILE_CHANGED: catalog skill moved during verification.');
  }
  return {
    name,
    skillId: entry.id,
    path: entry.path,
    sha256: createHash('sha256').update(document.text.replace(/\r\n?/g, '\n')).digest('hex')
  };
}

/** At worker bootstrap, fail closed if the skill no longer equals the admitted revision. */
export function verifyAgencyProfileDirective(authored: string, skills: readonly { id: string; text: string }[]): void {
  const marker = /^\/([a-z0-9._-]+)\n<!-- cos-agency:([a-z0-9._-]+):([0-9a-f]{64}) -->\n/.exec(authored);
  if (!marker) return;
  const [, commandId, boundId, digest] = marker;
  if (commandId !== boundId) throw new Error('AGENCY_PROFILE_MISMATCH: skill selection differs from bound profile.');
  const selected = skills.find(skill => skill.id === boundId);
  if (!selected || createHash('sha256').update(selected.text).digest('hex') !== digest) {
    throw new Error('AGENCY_PROFILE_CHANGED: the installed Agency skill no longer matches its verified launch revision.');
  }
}
