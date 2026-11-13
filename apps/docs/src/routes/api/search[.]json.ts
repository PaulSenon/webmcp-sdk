import { createFileRoute } from "@tanstack/react-router";
import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

const server = createFromSource(source, { language: "english" });

// Prerendered to a static JSON index (not served by a server): the search dialog downloads it
// on first use and searches in the browser.
export const Route = createFileRoute("/api/search.json")({
  server: { handlers: { GET: () => server.staticGET() } },
});
