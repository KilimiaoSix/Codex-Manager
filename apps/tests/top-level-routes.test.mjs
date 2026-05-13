import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import ts from "../node_modules/typescript/lib/typescript.js";

const appsRoot = path.resolve(import.meta.dirname, "..");
const sourcePath = path.join(
  appsRoot,
  "src",
  "lib",
  "app-shell",
  "top-level-routes.ts"
);

async function loadTopLevelRoutesModule() {
  const source = await fs.readFile(sourcePath, "utf8");
  const testableSource = source
    .replace('"use client";', "")
    .replace(
      'import { normalizeRoutePath } from "@/lib/utils/static-routes";',
      "function normalizeRoutePath(path: string): string { return !path || path === '/' ? '/' : path.replace(/\\/+$/, ''); }"
    )
    .replace('import type { AppRole } from "@/types";', "type AppRole = string;");
  const compiled = ts.transpileModule(testableSource, {
    compilerOptions: {
      module: ts.ModuleKind.ES2022,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  });

  const tempDir = await fs.mkdtemp(
    path.join(os.tmpdir(), "codexmanager-top-level-routes-")
  );
  const tempFile = path.join(tempDir, "top-level-routes.mjs");
  await fs.writeFile(tempFile, compiled.outputText, "utf8");
  return import(pathToFileURL(tempFile).href);
}

const routes = await loadTopLevelRoutesModule();

test("管理员菜单按任务域分组", () => {
  const sections = routes.getAllowedTopLevelRouteSections("admin");
  assert.deepEqual(
    sections.map((section) => section.label),
    ["概览", "资源接入", "模型路由", "用户与密钥", "运行监控", "系统设置"]
  );
  assert.deepEqual(
    sections.map((section) => section.routes.map((route) => route.path)),
    [
      ["/"],
      ["/accounts", "/aggregate-api"],
      ["/models"],
      ["/account-manager", "/apikeys", "/model-groups"],
      ["/logs"],
      ["/settings", "/plugins", "/author"],
    ]
  );
});

test("成员菜单只保留自助入口", () => {
  const sections = routes.getAllowedTopLevelRouteSections("member");
  assert.deepEqual(
    sections.map((section) => section.label),
    ["我的概览", "我的密钥", "可用模型", "使用记录", "账号设置"]
  );
  assert.deepEqual(
    sections.map((section) => section.routes.map((route) => route.path)),
    [["/"], ["/apikeys"], ["/models"], ["/logs"], ["/settings"]]
  );
  assert.equal(routes.getTopLevelRouteLabel("/apikeys", "member"), "我的密钥");
  assert.equal(routes.getTopLevelRouteLabel("/models", "member"), "可用模型");
  assert.equal(routes.getTopLevelRouteLabel("/settings", "member"), "账号设置");
});
