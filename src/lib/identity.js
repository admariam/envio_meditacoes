import { createHash } from 'node:crypto';

export function groupFingerprint(groupId) {
  return createHash('sha256')
    .update(`meditacoes-grupo-v1:${String(groupId).trim()}`)
    .digest('hex')
    .slice(0, 16);
}
