import { z } from "zod";

/**
 * zod for the whole app. Import `z` from here, never from "zod" directly: jitless mode stops
 * zod from probing `new Function("")` to compile parsers, which the nonce-based CSP
 * (script-src without 'unsafe-eval') reports as a violation in the browser. Importing this
 * module runs the configuration before any schema is defined or parsed.
 */
z.config({ jitless: true });

export { z };
