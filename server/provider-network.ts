import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { BlockList, isIP } from "node:net";

const restrictedIpv4 = new BlockList();
for (const [subnet, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  restrictedIpv4.addSubnet(subnet, prefix, "ipv4");

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
const restrictedIpv6 = new BlockList();
restrictedIpv6.addSubnet("2001::", 23, "ipv6");
restrictedIpv6.addSubnet("2001:db8::", 32, "ipv6");
restrictedIpv6.addSubnet("2002::", 16, "ipv6");
restrictedIpv6.addSubnet("3fff::", 20, "ipv6");

export function isPublicAddress(address: string) {
  const family = isIP(address);
  if (family === 4) return !restrictedIpv4.check(address, "ipv4");
  return (
    family === 6 &&
    globalIpv6.check(address, "ipv6") &&
    !restrictedIpv6.check(address, "ipv6")
  );
}

// Resolve once and connect to that exact address. The TLS name still matches the chosen provider.
export const fetchPublicProvider: typeof fetch = async (input, init) => {
  const url = new URL(String(input));
  if (
    url.protocol !== "https:" ||
    init?.method !== "POST" ||
    typeof init.body !== "string"
  )
    throw new Error("provider_endpoint");
  init.signal?.throwIfAborted();
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const address = (await lookup(hostname, { all: true })).find(({ address }) =>
    isPublicAddress(address),
  );
  if (!address) throw new Error("provider_endpoint");
  init.signal?.throwIfAborted();
  const body = init.body;
  return new Promise<Response>((resolve, reject) => {
    const connection = request(
      {
        hostname: address.address,
        port: url.port || 443,
        servername: isIP(hostname) ? undefined : hostname,
        path: url.pathname,
        method: "POST",
        signal: init.signal ?? undefined,
        headers: {
          ...Object.fromEntries(new Headers(init.headers)),
          host: url.host,
          "content-length": Buffer.byteLength(body),
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > 2 * 1024 * 1024)
            connection.destroy(new Error("provider_response_size"));
          else chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const status = response.statusCode ?? 502;
          const retryAfter = response.headers["retry-after"];
          const headers =
            typeof retryAfter === "string"
              ? { "Retry-After": retryAfter }
              : undefined;
          resolve(
            new Response(
              [204, 205, 304].includes(status) ? null : Buffer.concat(chunks),
              { status, headers },
            ),
          );
        });
      },
    );
    connection.on("error", reject);
    connection.end(body);
  });
};
