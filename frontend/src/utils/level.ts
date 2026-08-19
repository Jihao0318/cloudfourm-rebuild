// 经验等级曲线（与服务端一致）：30 级封顶
// 1-4 初学乍练 100/级，5-9 崭露头角 300/级，10-14 小有名气 500/级，
// 15-24 声名鹊起 800/级，25-30 名震一方 1200/级

export interface LevelInfo {
  level: number;
  tierName: string;
  expInLevel: number;
  expForNextLevel: number; // 0 表示已满级
  progress: number; // 0-1
}

function expPerLevelFor(level: number): number {
  if (level <= 4) return 100;
  if (level <= 9) return 300;
  if (level <= 14) return 500;
  if (level <= 24) return 800;
  if (level <= 29) return 1200;
  return 0; // 30 级封顶
}

function tierNameFor(level: number): string {
  if (level <= 4) return '初学乍练';
  if (level <= 9) return '崭露头角';
  if (level <= 14) return '小有名气';
  if (level <= 24) return '声名鹊起';
  return '名震一方';
}

export function levelFromExp(exp: number): LevelInfo {
  const e = Math.max(0, Math.floor(exp || 0));
  let level = 1;
  let rest = e;
  while (level < 30 && rest >= expPerLevelFor(level)) {
    rest -= expPerLevelFor(level);
    level++;
  }
  const expForNextLevel = expPerLevelFor(level);
  return {
    level,
    tierName: tierNameFor(level),
    expInLevel: rest,
    expForNextLevel,
    progress: expForNextLevel > 0 ? Math.min(1, rest / expForNextLevel) : 1,
  };
}
