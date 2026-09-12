type Option = { code: string; name: string };
const pending = new Map<string, Promise<Option[]>>();
const cached = new Map<string, { until: number; data: Option[] }>();

export function carrierAddressOptions(url: string): Promise<Option[]> {
  const hit = cached.get(url);
  if (hit && hit.until > Date.now()) return Promise.resolve(hit.data);
  const running = pending.get(url);
  if (running) return running;
  const request = fetch(url, { cache: 'no-store' }).then(async response => {
    if (!response.ok) throw new Error('address_list_failed');
    const body = await response.json();
    if (!Array.isArray(body.data) || !body.data.length) throw new Error('address_list_failed');
    const data = body.data.map((row: Option) => ({ code: String(row.code), name: row.name }));
    cached.set(url, { until: Date.now() + 300_000, data });
    return data;
  }).finally(() => pending.delete(url));
  pending.set(url, request);
  return request;
}
