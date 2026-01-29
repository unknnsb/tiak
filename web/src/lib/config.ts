export const API_BASE = (() => {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (!base) {
    console.error('NEXT_PUBLIC_API_BASE is not defined in environment variables');
    return '';
  }
  // Remove any accidental quotes if they managed to get in
  const cleaned = base.replace(/^['"]|['"]$/g, '');
  console.log('API_BASE initialized as:', cleaned);
  return cleaned;
})();
