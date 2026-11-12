import type { Config } from "@react-router/dev/config";
import { prerenderPaths } from "./prerender.ts";

// Fully static: no server runtime. Every route is prerendered to HTML (and `.data` for client
// navigations); `scripts/finalize-out.mjs` then turns build/client into the deployable `out/`.
export default {
  ssr: false,
  prerender: ({ getStaticPaths }) => prerenderPaths(getStaticPaths()),
} satisfies Config;
