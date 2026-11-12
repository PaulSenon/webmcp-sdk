import { docsLlms } from "@/lib/source";

export async function loader() {
  return new Response(await docsLlms.index(), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
