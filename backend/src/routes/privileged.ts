/**
 * Privileged route registry.
 *
 * Every route in this file is registered through `definePrivilegedRoute`, whose
 * `auth` field is mandatory. `dispatchPrivilegedRequest` performs that declared
 * check before calling a handler, so handlers cannot read or validate a body
 * from an unauthenticated request. The handlers keep their own authorization
 * checks too: the registry is the structural front door, not a replacement for
 * defense in depth inside each operation.
 */

import { authenticate, error, getBearer } from "../lib/http.ts";
import { config } from "../lib/config.ts";
import { hmacEquals, hmacHash } from "../lib/crypto.ts";
import type { Store } from "../lib/db.ts";
import type { HttpRequest } from "../lib/requestBody.ts";
import {
  handleAudit,
  handleCreateOrg,
  handleCreateUser,
  handleDeprovisionUser,
  handleListOrgUsers,
  handleListSeats,
  handleRevokeSeat,
  handleTransferSeat,
} from "./admin.ts";
import {
  handleAddMatterMember,
  handleArchiveMatter,
  handleClearWall,
  handleCreateMatter,
  handleListMatterMembers,
  handleListMatters,
  handleRemoveMatterMember,
  handleSetWall,
} from "./matters.ts";
import {
  handleCheckpointChunk,
  handleCheckpointManifest,
  handleCheckpointPrune,
} from "./checkpoints.ts";
import {
  handleSsoConfigDelete,
  handleSsoConfigGet,
  handleSsoConfigSet,
} from "./sso.ts";
import {
  handleDeleteProviderKey,
  handleInferenceBilling,
  handleListProviderKeys,
  handleSetProviderKey,
} from "./assured.ts";

export type PrivilegedAuth = "admin" | "provisioning";
export type PrivilegedMethod = "GET" | "POST";

type RouteHandler = (req: HttpRequest, params: Readonly<Record<string, string>>) => Response | Promise<Response>;

export interface PrivilegedRouteDefinition {
  id: string;
  method: PrivilegedMethod;
  path: `/${string}`;
  auth: PrivilegedAuth;
  purpose: string;
  handler: RouteHandler;
}

/**
 * The only constructor for a privileged route. The mandatory `auth` property is
 * also checked independently by scripts/check-backend-privileged-routes.mjs.
 */
export function definePrivilegedRoute(route: PrivilegedRouteDefinition): PrivilegedRouteDefinition {
  return Object.freeze(route);
}

/** Match a literal/`:parameter` route template without accepting extra segments. */
function matchTemplate(template: string, path: string): Readonly<Record<string, string>> | null {
  const expected = template.split("/");
  const actual = path.split("/");
  if (expected.length !== actual.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < expected.length; index++) {
    const wanted = expected[index]!;
    const got = actual[index]!;
    if (wanted.startsWith(":")) {
      if (!got) return null;
      try {
        params[wanted.slice(1)] = decodeURIComponent(got);
      } catch {
        return null;
      }
    } else if (wanted !== got) {
      return null;
    }
  }
  return params;
}

export function createPrivilegedRoutes(store: Store): readonly PrivilegedRouteDefinition[] {
  const matterId = (params: Readonly<Record<string, string>>): string => params.matterId!;

  return Object.freeze([
    definePrivilegedRoute({
      id: "provision-org",
      method: "POST",
      path: "/admin/org",
      auth: "provisioning",
      purpose: "Create an organization, its first administrator, and its initial license key.",
      handler: (req) => handleCreateOrg(req, store),
    }),

    definePrivilegedRoute({ id: "list-seats", method: "POST", path: "/org/seats", auth: "admin", purpose: "List the caller organization’s seats.", handler: (req) => handleListSeats(req, store) }),
    definePrivilegedRoute({ id: "revoke-seat", method: "POST", path: "/org/seat/revoke", auth: "admin", purpose: "Revoke a machine seat.", handler: (req) => handleRevokeSeat(req, store) }),
    definePrivilegedRoute({ id: "deprovision-user", method: "POST", path: "/org/user/deprovision", auth: "admin", purpose: "Deprovision a user and revoke their credentials.", handler: (req) => handleDeprovisionUser(req, store) }),
    definePrivilegedRoute({ id: "transfer-seat", method: "POST", path: "/org/seats/transfer", auth: "admin", purpose: "Transfer a seat to another user and machine.", handler: (req) => handleTransferSeat(req, store) }),
    definePrivilegedRoute({ id: "create-user", method: "POST", path: "/org/users", auth: "admin", purpose: "Create an organization user.", handler: (req) => handleCreateUser(req, store) }),
    definePrivilegedRoute({ id: "list-users", method: "POST", path: "/org/users/list", auth: "admin", purpose: "List organization users.", handler: (req) => handleListOrgUsers(req, store) }),
    definePrivilegedRoute({ id: "audit-post", method: "POST", path: "/org/audit", auth: "admin", purpose: "Read the organization audit log.", handler: (req) => handleAudit(req, store) }),
    definePrivilegedRoute({ id: "audit-get", method: "GET", path: "/org/audit", auth: "admin", purpose: "Read the organization audit log.", handler: (req) => handleAudit(req, store) }),

    definePrivilegedRoute({ id: "set-sso", method: "POST", path: "/org/sso/config/set", auth: "admin", purpose: "Set organization SSO configuration.", handler: (req) => handleSsoConfigSet(req, store) }),
    definePrivilegedRoute({ id: "get-sso", method: "POST", path: "/org/sso/config/get", auth: "admin", purpose: "Read organization SSO configuration.", handler: (req) => handleSsoConfigGet(req, store) }),
    definePrivilegedRoute({ id: "delete-sso", method: "POST", path: "/org/sso/config/delete", auth: "admin", purpose: "Delete organization SSO configuration.", handler: (req) => handleSsoConfigDelete(req, store) }),

    definePrivilegedRoute({ id: "create-matter", method: "POST", path: "/org/matters", auth: "admin", purpose: "Create a matter/client security boundary.", handler: (req) => handleCreateMatter(req, store) }),
    definePrivilegedRoute({ id: "list-matters", method: "POST", path: "/org/matters/list", auth: "admin", purpose: "List organization matters/clients.", handler: (req) => handleListMatters(req, store) }),
    definePrivilegedRoute({ id: "add-matter-member", method: "POST", path: "/matter/:matterId/members/add", auth: "admin", purpose: "Grant a user matter membership.", handler: (req, params) => handleAddMatterMember(req, store, matterId(params)) }),
    definePrivilegedRoute({ id: "remove-matter-member", method: "POST", path: "/matter/:matterId/members/remove", auth: "admin", purpose: "Remove a user’s matter membership and keys.", handler: (req, params) => handleRemoveMatterMember(req, store, matterId(params)) }),
    definePrivilegedRoute({ id: "list-matter-members", method: "POST", path: "/matter/:matterId/members/list", auth: "admin", purpose: "List matter members.", handler: (req, params) => handleListMatterMembers(req, store, matterId(params)) }),
    definePrivilegedRoute({ id: "set-matter-wall", method: "POST", path: "/matter/:matterId/wall/set", auth: "admin", purpose: "Screen a user from a matter and rotate keys.", handler: (req, params) => handleSetWall(req, store, matterId(params)) }),
    definePrivilegedRoute({ id: "clear-matter-wall", method: "POST", path: "/matter/:matterId/wall/clear", auth: "admin", purpose: "Clear a matter screen.", handler: (req, params) => handleClearWall(req, store, matterId(params)) }),
    definePrivilegedRoute({ id: "archive-matter", method: "POST", path: "/matter/:matterId/archive", auth: "admin", purpose: "Archive a matter/client.", handler: (req, params) => handleArchiveMatter(req, store, matterId(params)) }),

    definePrivilegedRoute({ id: "write-checkpoint-chunk", method: "POST", path: "/matter/:matterId/checkpoints/chunks", auth: "admin", purpose: "Write an encrypted checkpoint chunk.", handler: (req, params) => handleCheckpointChunk(req, store, matterId(params)) }),
    definePrivilegedRoute({ id: "publish-checkpoint-manifest", method: "POST", path: "/matter/:matterId/checkpoints/manifest", auth: "admin", purpose: "Publish an encrypted checkpoint manifest.", handler: (req, params) => handleCheckpointManifest(req, store, matterId(params)) }),
    definePrivilegedRoute({ id: "prune-checkpoint-tail", method: "POST", path: "/matter/:matterId/checkpoints/prune", auth: "admin", purpose: "Prune checkpointed encrypted update history.", handler: (req, params) => handleCheckpointPrune(req, store, matterId(params)) }),

    definePrivilegedRoute({ id: "set-provider-key", method: "POST", path: "/assured/keys/set", auth: "admin", purpose: "Set an encrypted managed provider key.", handler: (req) => handleSetProviderKey(req, store) }),
    definePrivilegedRoute({ id: "list-provider-keys", method: "POST", path: "/assured/keys/list", auth: "admin", purpose: "List managed provider-key metadata.", handler: (req) => handleListProviderKeys(req, store) }),
    definePrivilegedRoute({ id: "delete-provider-key", method: "POST", path: "/assured/keys/delete", auth: "admin", purpose: "Delete a managed provider key.", handler: (req) => handleDeleteProviderKey(req, store) }),
    definePrivilegedRoute({ id: "inference-billing", method: "POST", path: "/assured/billing", auth: "admin", purpose: "Read metadata-only managed-inference billing rows.", handler: (req) => handleInferenceBilling(req, store) }),
  ]);
}

/**
 * Return null when this is not a privileged route. A matched route is always
 * authenticated before its handler is called, and therefore before a body can
 * be read. Missing/invalid credentials get the same target-neutral response.
 */
export async function dispatchPrivilegedRequest(
  routes: readonly PrivilegedRouteDefinition[],
  req: HttpRequest,
  path: string,
  method: string,
): Promise<Response | null> {
  for (const route of routes) {
    if (route.method !== method) continue;
    const params = matchTemplate(route.path, path);
    if (!params) continue;

    if (route.auth === "provisioning") {
      const presented = getBearer(req) ?? "";
      if (!config.adminProvisionSecret || !hmacEquals(presented, hmacHash(config.adminProvisionSecret))) {
        return error("unauthorized", 401);
      }
    } else {
      const auth = authenticate(req);
      if (!auth.ok) return error("unauthorized", 401);
      if (auth.claims.role !== "admin") return error("forbidden", 403);
    }
    return await route.handler(req, params);
  }
  return null;
}
