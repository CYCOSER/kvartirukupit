const sourceFields = [
  'title', 'housingMarket', 'location', 'address', 'latitude', 'longitude', 'price', 'status',
  'area', 'landArea', 'bedrooms', 'floors', 'readiness', 'finish', 'seaDistance', 'description', 'utilities',
  'developer', 'district', 'completionDate', 'constructionStatus', 'priceKind', 'priceSourceUrl', 'priceArea',
] as const;
type Values = Record<string, unknown>;
type Baseline = { values: Values; manualFields: string[] };
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const values = (input: Values): Values => Object.fromEntries(sourceFields.filter(field => input[field] !== undefined).map(field => [field, input[field]]));
const object = (input: unknown): input is Values => !!input && typeof input === 'object' && !Array.isArray(input);
function readBaseline(previous: unknown): Baseline {
  return { values: object(previous) ? values(object(previous.values) ? previous.values : previous) : {},
    manualFields: object(previous) && Array.isArray(previous.manualFields)
      ? previous.manualFields.filter((field): field is string => typeof field === 'string' && sourceFields.some(source => source === field)) : [] };
}
function pairedFields(fields: Iterable<string>) {
  const manual = new Set(fields);
  for (const group of [['latitude', 'longitude'], ['price', 'priceKind', 'priceSourceUrl', 'priceArea']])
    if (group.some(field => manual.has(field))) group.forEach(field => manual.add(field));
  return manual;
}

export function rf39FeedBaseline(incoming: Values): Baseline {
  return { values: values(incoming), manualFields: [] };
}

export function rf39ManualBaseline(previous: unknown, fields: readonly string[]): Baseline {
  const baseline = readBaseline(previous);
  baseline.manualFields = [...pairedFields([...baseline.manualFields, ...fields.filter(field => sourceFields.some(source => source === field))])];
  return baseline;
}

export function mergeRf39Feed(current: Values, incoming: Values, previous: unknown): { changes: Values; baseline: Baseline } {
  const next = values(incoming), changes: Values = {};
  const { values: before, manualFields } = readBaseline(previous);
  let manual = new Set(manualFields);
  for (const field of sourceFields) {
    const comparison = field in before ? before : next;
    if (field in comparison && !same(current[field], comparison[field])) manual.add(field);
  }
  manual = pairedFields(manual);
  for (const field of sourceFields) {
    if (field in before && field in next && !manual.has(field) && !same(current[field], next[field])) changes[field] = next[field];
  }
  // Remember overrides even when a later feed happens to match the manually entered value.
  return { changes, baseline: { values: { ...before, ...next }, manualFields: [...manual] } };
}
