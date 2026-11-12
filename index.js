import { createSessionStart, defaultDeps } from "./session-start.js";

export default {
  id: "session-start",
  async setup(ctx) {
    const ss = createSessionStart(ctx.options ?? {}, defaultDeps());
    await ctx.session.hook("prompt", (input) => ss.onPrompt(input));
    await ctx.session.hook("context", (input) => ss.onContext(input));
  },
};
