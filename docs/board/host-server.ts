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

// Serve the static dashboard files.
app.use("*", serveStatic({ root: "./public" }));
app.get("*", serveStatic({ path: "./public/index.html" }));

const port = Number(process.env.PORT || 5200);
console.log(`[board] listening on 127.0.0.1:${port}`);
export default { port, hostname: "127.0.0.1", fetch: app.fetch };
