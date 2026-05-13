"use client";

import { normalizeRoutePath } from "@/lib/utils/static-routes";
import type { AppRole } from "@/types";

type TopLevelRouteSectionId =
  | "overview"
  | "resources"
  | "model-routing"
  | "users-keys"
  | "monitoring"
  | "system"
  | "member-overview"
  | "member-keys"
  | "member-models"
  | "member-usage"
  | "member-settings";

const ADMIN_ROUTE_SECTIONS = [
  "overview",
  "resources",
  "model-routing",
  "users-keys",
  "monitoring",
  "system",
] as const;

const MEMBER_ROUTE_SECTIONS = [
  "member-overview",
  "member-keys",
  "member-models",
  "member-usage",
  "member-settings",
] as const;

const ROUTE_SECTION_LABELS: Record<TopLevelRouteSectionId, string> = {
  overview: "概览",
  resources: "资源接入",
  "model-routing": "模型路由",
  "users-keys": "用户与密钥",
  monitoring: "运行监控",
  system: "系统设置",
  "member-overview": "我的概览",
  "member-keys": "我的密钥",
  "member-models": "可用模型",
  "member-usage": "使用记录",
  "member-settings": "账号设置",
};

export const TOP_LEVEL_ROUTE_CONFIG = [
  {
    path: "/",
    label: "仪表盘",
    memberLabel: "我的概览",
    section: "overview",
    memberSection: "member-overview",
    roles: ["system_admin", "admin", "member"],
  },
  {
    path: "/accounts",
    label: "OpenAI 账号池",
    section: "resources",
    roles: ["system_admin", "admin"],
  },
  {
    path: "/aggregate-api",
    label: "聚合 API",
    section: "resources",
    roles: ["system_admin", "admin"],
  },
  {
    path: "/models",
    label: "平台模型目录",
    memberLabel: "可用模型",
    section: "model-routing",
    memberSection: "member-models",
    roles: ["system_admin", "admin", "member"],
  },
  {
    path: "/account-manager",
    label: "成员账号",
    section: "users-keys",
    roles: ["system_admin", "admin"],
  },
  {
    path: "/apikeys",
    label: "平台密钥",
    memberLabel: "我的密钥",
    section: "users-keys",
    memberSection: "member-keys",
    roles: ["system_admin", "admin", "member"],
  },
  {
    path: "/model-groups",
    label: "模型组",
    section: "users-keys",
    roles: ["system_admin", "admin"],
  },
  {
    path: "/logs",
    label: "请求日志",
    memberLabel: "使用记录",
    section: "monitoring",
    memberSection: "member-usage",
    roles: ["system_admin", "admin", "member"],
  },
  {
    path: "/settings",
    label: "系统设置",
    memberLabel: "账号设置",
    section: "system",
    memberSection: "member-settings",
    roles: ["system_admin", "admin", "member"],
  },
  {
    path: "/plugins",
    label: "插件中心",
    section: "system",
    roles: ["system_admin", "admin"],
  },
  {
    path: "/author",
    label: "赞助与推荐",
    section: "system",
    roles: ["system_admin", "admin"],
  },
] as const;

export type TopLevelRoutePath = (typeof TOP_LEVEL_ROUTE_CONFIG)[number]["path"];
export type TopLevelRouteConfig = (typeof TOP_LEVEL_ROUTE_CONFIG)[number];

export interface TopLevelRouteSection {
  id: TopLevelRouteSectionId;
  label: string;
  routes: TopLevelRouteConfig[];
}

const TOP_LEVEL_ROUTE_SET = new Set<TopLevelRoutePath>(
  TOP_LEVEL_ROUTE_CONFIG.map((route) => route.path),
);

function normalizeRole(role: AppRole | string | null | undefined): string {
  return role || "system_admin";
}

export function isAdminTopLevelRole(
  role: AppRole | string | null | undefined,
): boolean {
  const normalizedRole = normalizeRole(role);
  return normalizedRole === "system_admin" || normalizedRole === "admin";
}

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

export function getTopLevelRouteLabel(
  path: string,
  role?: AppRole | string | null,
): string {
  const normalizedPath = normalizeRoutePath(path);
  const route = TOP_LEVEL_ROUTE_CONFIG.find((item) => item.path === normalizedPath);
  if (!route) return "CodexManager";
  if (!isAdminTopLevelRole(role) && "memberLabel" in route) {
    return route.memberLabel;
  }
  return route.label;
}

export function isTopLevelRouteAllowedForRole(
  path: string,
  role: AppRole | string | null | undefined,
): boolean {
  const normalizedPath = normalizeRoutePath(path);
  const normalizedRole = normalizeRole(role);
  const route = TOP_LEVEL_ROUTE_CONFIG.find((item) => item.path === normalizedPath);
  if (!route) return false;
  return (route.roles as readonly string[]).includes(normalizedRole);
}

export function getAllowedTopLevelRoutes(role: AppRole | string | null | undefined) {
  const normalizedRole = normalizeRole(role);
  return TOP_LEVEL_ROUTE_CONFIG.filter((route) =>
    (route.roles as readonly string[]).includes(normalizedRole),
  );
}

export function getAllowedTopLevelRouteSections(
  role: AppRole | string | null | undefined,
): TopLevelRouteSection[] {
  const adminRole = isAdminTopLevelRole(role);
  const sectionOrder = adminRole ? ADMIN_ROUTE_SECTIONS : MEMBER_ROUTE_SECTIONS;
  const sectionMap = new Map<TopLevelRouteSectionId, TopLevelRouteConfig[]>();
  for (const route of getAllowedTopLevelRoutes(role)) {
    const sectionId =
      !adminRole && "memberSection" in route ? route.memberSection : route.section;
    const current = sectionMap.get(sectionId) ?? [];
    current.push(route);
    sectionMap.set(sectionId, current);
  }
  return sectionOrder.flatMap((sectionId) => {
    const routes = sectionMap.get(sectionId) ?? [];
    if (routes.length === 0) return [];
    return [
      {
        id: sectionId,
        label: ROUTE_SECTION_LABELS[sectionId],
        routes,
      },
    ];
  });
}

export function getFirstAllowedTopLevelRoutePath(
  role: AppRole | string | null | undefined,
): TopLevelRoutePath {
  return getAllowedTopLevelRoutes(role)[0]?.path ?? "/";
}
