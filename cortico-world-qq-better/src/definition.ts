import type { WorldDefinition } from 'cortico/world.ts';
import { QQWorld } from './world.ts';
import { qqDefaults, type QQConfigSection } from './config.ts';

export const definition: WorldDefinition<QQConfigSection> = {
  id: 'qqbot',
  label: 'QQ 群聊',
  defaults: qqDefaults,
  create(ctx) {
    return new QQWorld(ctx.cfg, ctx.packageDir, ctx.dataDir);
  },
};
