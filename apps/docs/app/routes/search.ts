import { createFromSource } from "fumadocs-core/search/server";
import { source } from "@/lib/source";

const server = createFromSource(source, { language: "english" });

// Prerendered to a static JSON index; the search dialog downloads it and searches in the browser.
export async function loader() {
  return server.staticGET();
}
