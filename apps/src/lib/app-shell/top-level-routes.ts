"use client";

import { normalizeRoutePath } from "@/lib/utils/static-routes";
import type { AppRole } from "@/types";

export const TOP_LEVEL_ROUTE_CONFIG = [
  { path: "/", label: "仪表盘", roles: ["system_admin", "admin", "member"] },
  { path: "/accounts", label: "号池管理", roles: ["system_admin", "admin"] },
  { path: "/account-manager", label: "账号管理", roles: ["system_admin", "admin"] },
  { path: "/aggregate-api", label: "聚合API", roles: ["system_admin", "admin"] },
  { path: "/apikeys", label: "平台密钥", roles: ["system_admin", "admin", "member"] },
  { path: "/models", label: "模型管理", roles: ["system_admin", "admin", "member"] },
  { path: "/model-groups", label: "模型组", roles: ["system_admin", "admin"] },
  { path: "/plugins", label: "插件中心", roles: ["system_admin", "admin"] },
  { path: "/logs", label: "请求日志", roles: ["system_admin", "admin", "member"] },
  { path: "/settings", label: "设置", roles: ["system_admin", "admin", "member"] },
  { path: "/author", label: "赞助与推荐", roles: ["system_admin", "admin", "member"] },
] as const;

export type TopLevelRoutePath = (typeof TOP_LEVEL_ROUTE_CONFIG)[number]["path"];

const TOP_LEVEL_ROUTE_SET = new Set<TopLevelRoutePath>(
  TOP_LEVEL_ROUTE_CONFIG.map((route) => route.path),
);

export function isTopLevelRoutePath(path: string): path is TopLevelRoutePath {
  return TOP_LEVEL_ROUTE_SET.has(normalizeRoutePath(path) as TopLevelRoutePath);
}

export function toTopLevelRoutePath(path: string): TopLevelRoutePath {
  const normalizedPath = normalizeRoutePath(path);
  if (isTopLevelRoutePath(normalizedPath)) {
    return normalizedPath;
  }
  return "/";
}

export function getTopLevelRouteLabel(path: string): string {
  const normalizedPath = normalizeRoutePath(path);
  return (
    TOP_LEVEL_ROUTE_CONFIG.find((route) => route.path === normalizedPath)?.label ??
    "CodexManager"
  );
}

export function isTopLevelRouteAllowedForRole(
  path: string,
  role: AppRole | string | null | undefined,
): boolean {
  const normalizedPath = normalizeRoutePath(path);
  const normalizedRole = (role || "system_admin") as AppRole;
  const route = TOP_LEVEL_ROUTE_CONFIG.find((item) => item.path === normalizedPath);
  if (!route) return false;
  return (route.roles as readonly string[]).includes(normalizedRole);
}

export function getAllowedTopLevelRoutes(role: AppRole | string | null | undefined) {
  const normalizedRole = (role || "system_admin") as AppRole;
  return TOP_LEVEL_ROUTE_CONFIG.filter((route) =>
    (route.roles as readonly string[]).includes(normalizedRole),
  );
}

export function getFirstAllowedTopLevelRoutePath(
  role: AppRole | string | null | undefined,
): TopLevelRoutePath {
  return getAllowedTopLevelRoutes(role)[0]?.path ?? "/";
}
