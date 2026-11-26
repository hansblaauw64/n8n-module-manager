// Pure: environment label per instance (so test and production are never mixed up).
// All labels use the brand color (--color-brand in brand/brand.css). Production is a solid badge, the others
// are outlined, so production stands out at a glance. The id is what is stored; the label follows the language.
import { t } from './i18n.js';

const BRAND_COLOR = 'var(--color-brand)';

const env = (id, key, color, solid) => ({ id, color, solid, get label() { return t(key); } });

export const ENVIRONMENTS = [
  env('', 'env.none', null, false),
  env('test', 'env.test', BRAND_COLOR, false),
  env('acceptatie', 'env.acceptatie', BRAND_COLOR, false),
  env('productie', 'env.productie', BRAND_COLOR, true),
];

/** Info for an env id; unknown or empty gives the "no label" entry. */
export function envInfo(id) {
  return ENVIRONMENTS.find((e) => e.id === id) || ENVIRONMENTS[0];
}
