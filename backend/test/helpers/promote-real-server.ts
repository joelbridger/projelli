/** Tiny real Bun relay used only by the frontend promotion e2e test. */
import { Store } from '../../src/lib/db.ts';
import { FanoutHub } from '../../src/lib/matters.ts';
import { issueAuthTokens, mintSeatToken } from '../../src/lib/services.ts';
import { buildServeOptions, type SyncSocketData } from '../../src/server.ts';

const store = new Store(':memory:');
const org = store.createOrg({ name: 'Promotion e2e', plan: 'practice', packs: [], seat_limit: 2 });
const admin = store.createUser({ org_id: org.org_id, email: 'admin@promotion-e2e.test', password_hash: 'x', role: 'admin' });
const seat = store.activateSeat({ org_id: org.org_id, user_id: admin.user_id, machine_id: 'promotion-e2e', machine_label: null, seat_limit: 2 });
if (!seat.ok) throw new Error('promotion e2e could not activate seat');
const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
const token = issueAuthTokens(store, admin).access_token;
const seatToken = mintSeatToken(store.getOrg(org.org_id)!, admin, seat.seat).token;
process.stdout.write(`${JSON.stringify({ base: `http://${server.hostname}:${String(server.port)}`, token, seatToken, orgId: org.org_id })}\n`);

const close = () => { server.stop(true); store.close(); process.exit(0); };
process.once('SIGTERM', close);
process.once('SIGINT', close);
