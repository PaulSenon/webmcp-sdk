/**
 * Skip link of the home and 404 pages, placed like Fumadocs' own link on docs pages (right after
 * the banner): it jumps over the header to `#nd-page`, the content inside the page's single <main>.
 */
export function SkipLink() {
  return (
    <a href="#nd-page" className="skip-link">
      Skip to Content
    </a>
  );
}
