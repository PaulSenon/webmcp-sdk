import { HomeLayout } from "fumadocs-ui/layouts/home";
import { Link } from "@tanstack/react-router";
import { baseOptions } from "@/lib/layout.shared";
import { SkipLink } from "@/components/skip-link";

// The router's not-found component; also prerendered at /404 and published as /404.html.
export function NotFound() {
  return (
    <>
      <SkipLink />
      <HomeLayout {...baseOptions()}>
        <title>Page not found | webmcp-sdk</title>
        <meta name="description" content="This page does not exist, or it moved." />
        <meta name="robots" content="noindex" />
        <div id="nd-page" className="p-4 flex flex-col items-center justify-center text-center flex-1">
          <h1 className="text-xl font-bold mb-2">Page not found</h1>
          <p className="text-fd-muted-foreground mb-4">This page does not exist, or it moved.</p>
          <Link className="text-sm bg-fd-primary text-fd-primary-foreground rounded-full font-medium px-4 py-2.5" to="/docs/$" params={{ _splat: "" }}>
            Back to the docs
          </Link>
        </div>
      </HomeLayout>
    </>
  );
}
