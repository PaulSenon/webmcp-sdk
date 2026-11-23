import { createFileRoute, notFound } from "@tanstack/react-router";
import { NotFound } from "@/components/not-found";

// Catch-all for unknown URLs, and the source of /404.html.
// - At build time it renders <NotFound /> for /404 with status 200 (TanStack's prerender refuses
//   non-2xx pages); scripts/finalize-out.mjs publishes it as /404.html, which the host serves with
//   status 404 for every URL that is not a file.
// - In the browser it throws notFound(), so the router's defaultNotFoundComponent (the same
//   <NotFound />) renders, as for an unknown /docs/… slug. A route component would not hydrate:
//   its match id contains the URL (`$#404` vs `$#<any other path>`).
export const Route = createFileRoute("/$")({
  loader: () => {
    if (!import.meta.env.SSR) throw notFound();
  },
  component: NotFound,
});
