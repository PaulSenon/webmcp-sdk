import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { repoUrl, site } from "./site";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: (
        <>
          <img src="/icon.svg" alt="" width={24} height={24} />
          <span className="font-semibold">{site.name}</span>
        </>
      ),
    },
    githubUrl: repoUrl,
    links: [{ text: "Docs", url: "/docs", active: "nested-url" }],
  };
}
