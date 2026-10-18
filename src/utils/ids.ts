export const generateId = (prefix = 'id'): string => {
  const safePrefix = prefix.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'id';
  return `${safePrefix}_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
};
