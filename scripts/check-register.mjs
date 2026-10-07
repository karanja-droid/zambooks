import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function checkRegister(markdown) {
  const errors = [];
  const seen = new Set();
  for (const line of markdown.split('\n').filter((l) => /^\|\s*ZM-/.test(l))) {
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 8) {
      errors.push(`${line}: expected 8 columns, got ${cells.length}`);
      continue;
    }
    const [id, rule, source, , , , verifiedBy, status] = cells;
    if (!/^ZM-\d{4}$/.test(id)) errors.push(`${id}: id must be ZM-NNNN`);
    if (seen.has(id)) errors.push(`${id}: duplicate id`);
    seen.add(id);
    if (!rule) errors.push(`${id}: rule is required`);
    if (!source) errors.push(`${id}: source is required`);
    if (status !== 'VERIFY' && status !== 'VERIFIED') errors.push(`${id}: status must be VERIFY or VERIFIED`);
    if (status === 'VERIFIED') {
      if (!/^[^,]+,[^,]+,\s*\d{4}-\d{2}-\d{2}$/.test(verifiedBy)) {
        errors.push(`${id}: VERIFIED needs verified_by "name, qualification, YYYY-MM-DD"`);
      } else if (/\b(claude|ai|llm|gpt|model)\b/i.test(verifiedBy)) {
        errors.push(`${id}: only a human may verify (spec §10)`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const errors = checkRegister(readFileSync(process.argv[2], 'utf8'));
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
  }
  console.log('register ok');
}
