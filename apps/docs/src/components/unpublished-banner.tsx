import { Banner } from "fumadocs-ui/components/banner";
import { site } from "@/lib/site";

/** Owner decision D8: until the first npm release, every page says the package is not published. */
export function UnpublishedBanner() {
  if (site.published) return null;
  return (
    <Banner id="unpublished" className="text-center">
      <span>
        <strong>Not published yet.</strong> <code>{site.packageName}</code> is not on npm; this site documents the{" "}
        <code>main</code> branch.
      </span>
    </Banner>
  );
}
