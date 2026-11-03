const part = (label, q) => !q || !Number.isFinite(q.usedPercentage) ? `${label} –` : `${label} ${Math.round(q.usedPercentage)}%${q.stale ? '*' : ''}`;
export const formatTrayTitle = (quota) => `${part('5h', quota?.fiveHour)} · ${part('7d', quota?.sevenDay)}`;
