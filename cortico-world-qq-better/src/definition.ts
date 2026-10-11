import type { WorldDefinition } from 'cortico/world.ts';
import { QQWorld } from './world.ts';
import { qqDefaults, qqTimezoneOptions, type QQConfigSection } from './config.ts';

export const definition: WorldDefinition<QQConfigSection> = {
  id: 'qqbot',
  label: 'QQ 群聊',
  defaults: qqDefaults,
  configOptions(kind) {
    if (kind === 'qq-timezone') return qqTimezoneOptions();
    return [];
  },
  create(ctx) {
    return new QQWorld(ctx.cfg, ctx.packageDir, ctx.dataDir);
  },
};
