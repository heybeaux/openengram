export type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

export interface ApiRouteContract {
  readonly method: HttpMethod;
  readonly path: string;
  readonly description: string;
  readonly consumers: readonly string[];
}

export const apiRoutes = {
  memories: {
    create: {
      method: "POST",
      path: "/v1/memories",
      description: "Create a memory",
      consumers: ["client-js", "mcp", "channel-intelligence"],
    },
    batchCreate: {
      method: "POST",
      path: "/v1/memories/batch",
      description: "Create many memories",
      consumers: ["client-js"],
    },
    get: {
      method: "GET",
      path: "/v1/memories/:id",
      description: "Get a memory by id",
      consumers: ["client-js"],
    },
    update: {
      method: "PATCH",
      path: "/v1/memories/:id",
      description: "Update a memory by id",
      consumers: ["client-js"],
    },
    delete: {
      method: "DELETE",
      path: "/v1/memories/:id",
      description: "Delete/forget a memory by id",
      consumers: ["client-js", "mcp"],
    },
    query: {
      method: "POST",
      path: "/v1/memories/query",
      description: "Structured memory query",
      consumers: ["mcp"],
    },
    recall: {
      method: "POST",
      path: "/v1/recall",
      description: "Recall memories",
      consumers: ["client-js", "channel-intelligence"],
    },
    context: {
      method: "POST",
      path: "/v1/context",
      description: "Generate context from memories",
      consumers: ["mcp"],
    },
  },
  pools: {
    list: {
      method: "GET",
      path: "/v1/pools",
      description: "List memory pools",
      consumers: ["channel-intelligence"],
    },
    create: {
      method: "POST",
      path: "/v1/pools",
      description: "Create memory pool",
      consumers: ["channel-intelligence"],
    },
  },
  hierarchy: {
    search: {
      method: "POST",
      path: "/v1/hierarchy/search",
      description: "Hierarchy search",
      consumers: ["mcp"],
    },
  },
  observe: {
    create: {
      method: "POST",
      path: "/v1/observe",
      description: "Observe conversation/content for auto memory extraction",
      consumers: ["mcp"],
    },
  },
  health: {
    get: {
      method: "GET",
      path: "/v1/health",
      description: "Service health",
      consumers: ["client-js", "mcp"],
    },
  },
  stats: {
    dashboard: {
      method: "GET",
      path: "/v1/stats",
      description: "Dashboard/account memory stats",
      consumers: ["client-js", "mcp"],
    },
  },
  consolidation: {
    generateContext: {
      method: "POST",
      path: "/v1/consolidation/generate-context",
      description: "Generate consolidation context",
      consumers: ["client-js"],
    },
    dreamCycle: {
      method: "POST",
      path: "/v1/consolidation/dream-cycle",
      description: "Run dream cycle",
      consumers: ["client-js"],
    },
  },
  dedup: {
    scan: {
      method: "POST",
      path: "/v1/dedup/scan",
      description: "Run deduplication scan",
      consumers: ["client-js"],
    },
  },
  webhooks: {
    create: {
      method: "POST",
      path: "/v1/webhooks",
      description: "Create webhook",
      consumers: ["client-js"],
    },
    list: {
      method: "GET",
      path: "/v1/webhooks",
      description: "List webhooks",
      consumers: ["client-js"],
    },
    get: {
      method: "GET",
      path: "/v1/webhooks/:id",
      description: "Get webhook",
      consumers: ["client-js"],
    },
    update: {
      method: "PATCH",
      path: "/v1/webhooks/:id",
      description: "Update webhook",
      consumers: ["client-js"],
    },
    delete: {
      method: "DELETE",
      path: "/v1/webhooks/:id",
      description: "Delete webhook",
      consumers: ["client-js"],
    },
    test: {
      method: "POST",
      path: "/v1/webhooks/:id/test",
      description: "Test webhook delivery",
      consumers: ["client-js"],
    },
    deliveries: {
      method: "GET",
      path: "/v1/webhooks/:id/deliveries",
      description: "List webhook deliveries",
      consumers: ["client-js"],
    },
  },
} as const satisfies Record<string, Record<string, ApiRouteContract>>;

export type ApiRoutes = typeof apiRoutes;

export function flattenApiRoutes(
  routes: ApiRoutes = apiRoutes,
): ApiRouteContract[] {
  return Object.values(routes).flatMap((group) => Object.values(group));
}

export function routePatternToRegExp(path: string): RegExp {
  const escaped = path
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/\\:([A-Za-z0-9_]+)/g, "[^/]+");
  return new RegExp(`^${escaped}$`);
}
