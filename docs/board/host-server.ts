import { Hono } from "hono";
import { serveStatic } from "hono/bun";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";

// Private host for the Lantern Board Dashboard (canonical: lantern.jameworld.com).
// Login gate: requires a valid Jameworld `auth_token` JWT (HS256, shared JWT_SECRET).
// Jameworld sets that cookie scoped to `.jameworld.com`, so it's already sent to
// lantern.jameworld.com — one Jameworld login covers it. Unlike Career Coach, the gate
// here wraps EVERY route (the HTML itself is private), not just /api/*.

const app = new Hono();

async function isLoggedIn(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) return false; // misconfigured → fail closed
  try {
    const p = (await verify(token, secret, "HS256")) as unknown as {
      sub: number;
      username: string;
    };
    return typeof p.sub === "number" && !!p.username;
  } catch {
    return false; // bad signature or expired
  }
}

// Public health check (no auth) for monitoring.
app.get("/api/health", (c) => c.json({ ok: true }));

// Canonical host: this board was renamed board.jameworld.com -> lantern.jameworld.com.
// Forward the old hostname (301) to the new one, preserving path + query, so any old
// links or bookmarks land on the new name.
app.use("*", async (c, next) => {
  if ((c.req.header("host") || "") === "board.jameworld.com") {
    const search = new URL(c.req.url).search || "";
    return c.redirect("https://lantern.jameworld.com" + c.req.path + search, 301);
  }
  return next();
});

// Everything else requires a logged-in Jameworld user.
app.use("*", async (c, next) => {
  if (await isLoggedIn(getCookie(c, "auth_token"))) return next();
  return c.redirect("https://jameworld.com", 302);
});

// ── Feature-map comments (family feedback pinned to the whiteboard) ─────────
// Stored as one JSON file on disk; all routes sit behind the login gate above.
const COMMENTS_FILE = "./data/feature-map-comments.json";

type MapComment = {
  id: string;
  x: number;
  y: number;
  text: string;
  author: string;
  postedBy?: string; // verified login username (audit; author is just a display name)
  ts: string;
};

async function readComments(): Promise<MapComment[]> {
  try {
    const f = Bun.file(COMMENTS_FILE);
    if (!(await f.exists())) return [];
    const data = (await f.json()) as unknown;
    return Array.isArray(data) ? (data as MapComment[]) : [];
  } catch {
    return [];
  }
}

async function writeComments(list: MapComment[]): Promise<void> {
  await Bun.write(COMMENTS_FILE, JSON.stringify(list, null, 1));
}

// Serialize all read-modify-write mutations so two simultaneous posts/deletes
// can't clobber each other's write (verified live: two parallel DELETEs lost one).
let commentsQueue: Promise<unknown> = Promise.resolve();
function withCommentsQueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = commentsQueue.then(fn, fn);
  commentsQueue = run.catch(() => undefined);
  return run;
}

// Verified username from the (already-validated) login cookie — recorded on
// every comment so a typed display name can't silently impersonate someone.
async function verifiedUsername(token: string | undefined): Promise<string> {
  if (!token) return "";
  const secret = process.env.JWT_SECRET;
  if (!secret) return "";
  try {
    const p = (await verify(token, secret, "HS256")) as unknown as { username?: string };
    return typeof p.username === "string" ? p.username : "";
  } catch {
    return "";
  }
}

// CSRF guard for mutating routes: the login cookie is domain-wide, so require
// the request to actually come from a jameworld.com page (fetch sends Origin).
function sameSiteOrigin(c: { req: { header: (n: string) => string | undefined } }): boolean {
  const origin = c.req.header("origin") ?? "";
  if (!origin) return true; // same-origin fetches may omit Origin; cross-site POSTs never do
  try {
    const h = new URL(origin).hostname;
    return h === "jameworld.com" || h.endsWith(".jameworld.com");
  } catch {
    return false;
  }
}

app.get("/api/feature-map/comments", async (c) => {
  return c.json(await readComments());
});

app.post("/api/feature-map/comments", async (c) => {
  if (!sameSiteOrigin(c)) return c.json({ error: "forbidden" }, 403);
  let body: { x?: unknown; y?: unknown; text?: unknown; author?: unknown };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "bad json" }, 400);
  }
  const x = Number(body.x);
  const y = Number(body.y);
  const text = String(body.text ?? "").trim().slice(0, 2000);
  const author = String(body.author ?? "").trim().slice(0, 60) || "Anonymous";
  if (!Number.isFinite(x) || !Number.isFinite(y) || !text) {
    return c.json({ error: "need x, y and text" }, 400);
  }
  const postedBy = await verifiedUsername(getCookie(c, "auth_token"));
  const item = await withCommentsQueue(async () => {
    const list = await readComments();
    const it: MapComment = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      x,
      y,
      text,
      author,
      postedBy,
      ts: new Date().toISOString(),
    };
    list.push(it);
    await writeComments(list);
    return it;
  });
  return c.json(item, 201);
});

app.delete("/api/feature-map/comments/:id", async (c) => {
  if (!sameSiteOrigin(c)) return c.json({ error: "forbidden" }, 403);
  const id = c.req.param("id");
  const found = await withCommentsQueue(async () => {
    const list = await readComments();
    const next = list.filter((it) => it.id !== id);
    if (next.length === list.length) return false;
    await writeComments(next);
    return true;
  });
  if (!found) return c.json({ error: "not found" }, 404);
  return c.json({ ok: true });
});

// Serve the static dashboard files.
app.use("*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT || 5200);
console.log(`[board] listening on 127.0.0.1:${port}`);
export default { port, hostname: "127.0.0.1", fetch: app.fetch };
