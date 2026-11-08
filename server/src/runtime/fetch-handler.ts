import { getApp } from "./app-instance";
import { applySecurityHeaders } from "../utils/security-headers";

const ROOT_FEED_PATTERN = /^\/(rss\.xml|atom\.xml|rss\.json|feed\.json|feed\.xml)$/;
const APP_PUBLIC_ROUTE_PATTERN = /^\/(favicon|favicon\.ico)(?:\/|$)/;
// 由 Worker 直接处理的元数据路由（sitemap / robots），需在静态资源分支之前路由到 Hono 应用
const APP_META_ROUTE_PATTERN = /^\/(sitemap\.xml|robots\.txt)$/;

function isApiRequest(pathname: string) {
  return pathname.startsWith("/api/");
}

function rewriteApiRequest(request: Request) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace(/^\/api(?=\/|$)/, "") || "/";
  return new Request(url, request);
}

function isRootFeedRequest(pathname: string) {
  return ROOT_FEED_PATTERN.test(pathname);
}

function isAppPublicRoute(pathname: string) {
  return APP_PUBLIC_ROUTE_PATTERN.test(pathname);
}

function isMetaRoute(pathname: string) {
  return APP_META_ROUTE_PATTERN.test(pathname);
}

function isStaticAssetRequest(pathname: string) {
  return /\.\w+$/.test(pathname);
}

async function tryServeAsset(request: Request, env: Env) {
  if (!env.ASSETS) {
    return null;
  }

  try {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 200 || (asset.status >= 300 && asset.status < 400)) {
      return asset;
    }
  } catch {}

  return null;
}

async function serveSpaEntry(request: Request, env: Env) {
  if (!env.ASSETS) {
    return null;
  }

  try {
    const url = new URL(request.url);
    const indexRequest = new Request(new URL("/", url.origin), request);
    const indexResponse = await env.ASSETS.fetch(indexRequest);
    if (indexResponse.status === 200 || (indexResponse.status >= 300 && indexResponse.status < 400)) {
      return indexResponse;
    }
  } catch {}

  return null;
}

export async function handleFetch(
  request: Request,
  env: Env,
  executionContext?: ExecutionContext,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  let response: Response;

  if (isRootFeedRequest(pathname)) {
    response = await getApp().fetch(request, env, executionContext);
  } else if (isApiRequest(pathname)) {
    response = await getApp().fetch(rewriteApiRequest(request), env, executionContext);
  } else if (isAppPublicRoute(pathname)) {
    response = await getApp().fetch(request, env, executionContext);
  } else if (isMetaRoute(pathname)) {
    response = await getApp().fetch(request, env);
  } else if (isStaticAssetRequest(pathname)) {
    response = (await tryServeAsset(request, env)) ?? (await serveSpaEntry(request, env)) ?? new Response("Hi", { status: 200 });
  } else {
    response = (await serveSpaEntry(request, env)) ?? new Response("Hi", { status: 200 });
  }

  return applySecurityHeaders(response);
}
