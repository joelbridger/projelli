#!/usr/bin/env node
// Turns Packet Monitor's decoded ETL text into a small, reviewable traffic
// summary. PktMon may emit a packet at several Windows layers, so this is an
// observation record rather than a packet-counting benchmark.
import fs from 'node:fs/promises';

const args = process.argv.slice(2);
const arg = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const textPath = arg('--text');
const pcapPath = arg('--pcap');
const outputPath = arg('--output');
const from = arg('--from') ? new Date(arg('--from')) : null;
const to = arg('--to') ? new Date(arg('--to')) : null;
const utcOffsetHours = Number(arg('--utc-offset-hours') ?? 0);
if (!textPath || !pcapPath || !outputPath) throw new Error('Usage: --text FILE --pcap FILE --output FILE');

const isLoopback = (host) => host === '127.0.0.1' || host === '::1' || host === 'localhost' || host === '0:0:0:0:0:0:0:1';
const unique = (rows) => [...new Map(rows.map((row) => [`${row.source}.${row.sourcePort}>${row.destination}.${row.destinationPort}:${row.detail}`, row])).values()];

function endpoint(line) {
  const address = '(?:(?:\\d{1,3}\\.){3}\\d{1,3}|[0-9a-fA-F:]+)';
  const match = line.match(new RegExp(`(${address})\\.(\\d+) > (${address})\\.(\\d+):`));
  return match ? { source: match[1], sourcePort: Number(match[2]), destination: match[3], destinationPort: Number(match[4]), detail: line.slice(match.index).trim() } : null;
}

function decodedPackets(text) {
  const lines = text.split(/\r?\n/);
  const packets = [];
  for (let index = 0; index < lines.length; index += 1) {
    const header = lines[index];
    if (!header.includes('PktGroupId') || !header.includes('Direction Tx')) continue;
    const group = header.match(/PktGroupId\s+(\d+)/)?.[1] ?? 'unknown';
    const timestampText = header.match(/::(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2}\.\d+)/);
    const observedAt = timestampText
      ? new Date(`${timestampText[1]}T${timestampText[2]}${utcOffsetHours < 0 ? '-' : '+'}${String(Math.floor(Math.abs(utcOffsetHours))).padStart(2, '0')}:00`)
      : null;
    if ((from && (!observedAt || observedAt < from)) || (to && (!observedAt || observedAt > to))) continue;
    const detail = lines[index + 1] ?? '';
    const parsed = endpoint(detail);
    if (parsed) packets.push({ group, observedAt: observedAt?.toISOString() ?? null, ...parsed, detail: parsed.detail });
  }
  return packets;
}

// PktMon's pcapng contains a mix of raw IP, Ethernet, and Wi-Fi frames. A TLS
// ClientHello has a stable record/handshake prefix; retaining this check makes
// encrypted connection attempts visible even when HTTP decoding is impossible.
function countClientHellos(buffer) {
  let count = 0;
  for (let i = 0; i + 5 < buffer.length; i += 1) {
    if (buffer[i] === 0x16 && buffer[i + 1] === 0x03 && buffer[i + 2] <= 0x04 && buffer[i + 5] === 0x01) count += 1;
  }
  return count;
}

const textBuffer = await fs.readFile(textPath);
const text = textBuffer.toString('utf16le');
const pcap = await fs.readFile(pcapPath);
const packets = decodedPackets(text);
const external = (packet) => !isLoopback(packet.destination);
const outboundDnsQueries = unique(packets.filter((packet) => external(packet) && packet.destinationPort === 53));
const outboundTcpSyn = unique(packets.filter((packet) => external(packet) && /Flags \[S\]/.test(packet.detail)));
const outboundUdpDatagrams = unique(packets.filter((packet) => external(packet) && /:\s+UDP,/.test(packet.detail)));
const allOutboundNonLoopback = unique(packets.filter(external));
const result = {
  generatedAt: new Date().toISOString(),
  source: { decodedEtl: textPath, pcapng: pcapPath },
  window: { from: from?.toISOString() ?? null, to: to?.toISOString() ?? null, pktmonUtcOffsetHours: utcOffsetHours },
  note: 'PktMon is machine-wide. Firewall rules scope enforcement to Lantern and WebView2; this passive capture independently records traffic during the same window.',
  outboundDnsQueries,
  outboundTcpSyn,
  outboundUdpDatagrams,
  tlsClientHelloRecordCount: from || to ? null : countClientHellos(pcap),
  outboundNonLoopbackSample: allOutboundNonLoopback.slice(0, 100),
};
await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ dns: outboundDnsQueries.length, tcpSyn: outboundTcpSyn.length, udp: outboundUdpDatagrams.length, tlsClientHelloRecords: result.tlsClientHelloRecordCount }, null, 2));
