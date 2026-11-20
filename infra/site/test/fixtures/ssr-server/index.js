// Prebuilt SSR Worker fixture (what a framework build emits as server/index.js + sibling modules).
import { greet } from "./lib.js";
export default {
  async fetch(request, env) {
    if (new URL(request.url).pathname === "/api/hello") return new Response(greet(), { headers: { "content-type": "text/plain" } });
    return env.ASSETS.fetch(request);
  },
};
