export function displayNameInitials(value: string): string {
  const words = value.trim().split(/\s+/u).filter(Boolean);
  if (words.length >= 2) {
    return `${Array.from(words[0])[0] ?? ''}${Array.from(words[1])[0] ?? ''}`.toLocaleUpperCase('zh-CN');
  }
  return Array.from(words[0] ?? '').slice(0, 2).join('').toLocaleUpperCase('zh-CN') || 'U';
}
