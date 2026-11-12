import { HomeLayout } from "fumadocs-ui/layouts/home";
import { Link } from "react-router";
import { baseOptions } from "@/lib/layout.shared";
import { PageMeta } from "@/components/page-meta";
import { repoUrl, site } from "@/lib/site";

const steps = [
  { name: "defineTool", what: "the contract", text: "Name, description and Standard Schema input/output. No code, no browser: share it with tests and callers." },
  { name: "implementTool", what: "your code", text: "A handler with input and output types inferred from the definition, sync or async." },
  { name: "registerTool", what: "the lifetime", text: "WebMCP's own model: an AbortSignal. Validation and agent-readable errors included." },
];

export default function Home() {
  return (
    <HomeLayout {...baseOptions()}>
      <PageMeta path="/" />
      <main className="flex flex-col items-center px-4 py-16 md:py-24 gap-12 flex-1">
        <section className="flex flex-col items-center text-center gap-4 max-w-2xl">
          <img src="/icon.svg" alt="" width={64} height={64} />
          <h1 className="text-3xl md:text-4xl font-bold">Type-safe WebMCP tools for TypeScript</h1>
          <p className="text-fd-muted-foreground text-lg">
            Define tools with Standard Schema, implement them with inferred types, register them with validation and
            agent-readable errors, and discover them from an in-page agent. React bindings included.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Link className="text-sm bg-fd-primary text-fd-primary-foreground rounded-full font-medium px-4 py-2.5" to="/docs/quick-start">
              Quick start
            </Link>
            <Link className="text-sm border rounded-full font-medium px-4 py-2.5 hover:bg-fd-accent" to="/docs">
              Read the docs
            </Link>
            <a className="text-sm border rounded-full font-medium px-4 py-2.5 hover:bg-fd-accent" href={repoUrl}>
              GitHub
            </a>
          </div>
        </section>
        <section className="grid gap-4 md:grid-cols-3 max-w-5xl w-full">
          {steps.map((step, i) => (
            <div key={step.name} className="rounded-xl border bg-fd-card p-5 flex flex-col gap-2">
              <p className="text-xs text-fd-muted-foreground">
                {i + 1}. {step.what}
              </p>
              <code className="font-semibold">{step.name}</code>
              <p className="text-sm text-fd-muted-foreground">{step.text}</p>
            </div>
          ))}
        </section>
        <p className="text-sm text-fd-muted-foreground text-center max-w-2xl">
          WebMCP is an experimental W3C Community Group draft. {site.packageName} is not affiliated with the unrelated{" "}
          <code>webmcp-sdk</code> or <code>@webmcp-sdk/*</code> packages on npm.
        </p>
      </main>
    </HomeLayout>
  );
}
