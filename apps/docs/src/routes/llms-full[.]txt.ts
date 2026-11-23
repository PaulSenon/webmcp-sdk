import { createFileRoute } from "@tanstack/react-router";
import { docsLlms } from "@/lib/source";

// For LLMs (https://llmstxt.org). Prerendered to a static file.
export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () => new Response(await docsLlms.full(), { headers: { "Content-Type": "text/plain; charset=utf-8" } }),
    },
  },
});
