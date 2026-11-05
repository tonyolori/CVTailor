import { errorFields, log } from "./lib/log";

/** Next calls this for any uncaught server error, including page renders that nothing else wraps. */
export function onRequestError(err: unknown, request: { path: string; method: string }, context: { routerKind: string; routePath?: string; routeType: string }): void {
  log("request.error", { method: request.method, path: request.path.split("?")[0], routePath: context.routePath, routeType: context.routeType, ...errorFields(err) }, "error");
}
