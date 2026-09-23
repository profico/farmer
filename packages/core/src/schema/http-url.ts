import { z } from "zod";

/**
 * A URL a browser may follow: http or https, nothing else.
 *
 * `z.url()` accepts any scheme the URL parser knows, so `javascript:`,
 * `data:` and `file:` all passed, and these values end up in an `href` or an
 * `src`. Only the scheme is narrowed: `z.httpUrl()` also demands a dotted
 * domain, which would refuse a meeting on an IP address or a self-hosted logo
 * on `localhost`.
 */
export const httpUrlSchema = z.url({ protocol: /^https?$/ });
