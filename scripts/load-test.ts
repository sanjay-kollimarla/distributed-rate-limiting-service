/**
 * Minimal load generator: many concurrent clients (distinct API keys or IPs)
 * hammering the service. Usage: bun scripts/load-test.ts [url] [clients] [seconds]
 */
const [url = "http://localhost:3000/api/resource", clientsArg = "100", secondsArg = "10"] = process.argv.slice(2);
const clients = Number(clientsArg);
const deadline = Date.now() + Number(secondsArg) * 1000;

const counts = new Map<number, number>();
let total = 0;

async function worker(id: number): Promise<void> {
  while (Date.now() < deadline) {
    const res = await fetch(url, { headers: { "x-forwarded-for": `10.0.${id >> 8}.${id & 255}` } });
    await res.arrayBuffer();
    counts.set(res.status, (counts.get(res.status) ?? 0) + 1);
    total += 1;
  }
}

const startedAt = performance.now();
await Promise.all(Array.from({ length: clients }, (_, id) => worker(id)));
const seconds = (performance.now() - startedAt) / 1000;

console.log(`${total} requests, ${clients} clients, ${(total / seconds).toFixed(0)} req/s`);
console.log("status codes:", Object.fromEntries(counts));
