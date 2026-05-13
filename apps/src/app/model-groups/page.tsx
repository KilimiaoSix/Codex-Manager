"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, PencilLine, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { useDesktopPageActive } from "@/hooks/useDesktopPageActive";
import { isAdminRole, useAppSession } from "@/hooks/useAppSession";
import { usePageTransitionReady } from "@/hooks/usePageTransitionReady";
import { accountClient } from "@/lib/api/account-client";
import { appClient } from "@/lib/api/app-client";
import { getAppErrorMessage } from "@/lib/api/transport";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import { AppUser, ManagedModelInfo, ModelGroup, ModelGroupModel } from "@/types";

type ModelDraft = {
  enabled: boolean;
  rateMultiplier: string;
  billingModelSlug: string;
  note: string;
};

const QUERY_KEYS = {
  groups: ["model-groups"] as const,
  models: ["model-groups", "catalog"] as const,
  users: ["model-groups", "users"] as const,
};

function multiplierToText(value?: number | null): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";
  return (value / 1000).toFixed(2).replace(/\.?0+$/, "");
}

function parseMultiplier(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number.parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 1000);
}

function activeMemberUsers(users: AppUser[]): AppUser[] {
  return users.filter((user) => user.role === "member" && user.status === "active");
}

function modelDraftFromEntry(entry?: ModelGroupModel): ModelDraft {
  return {
    enabled: Boolean(entry),
    rateMultiplier: multiplierToText(entry?.rateMultiplierMillis),
    billingModelSlug: entry?.billingModelSlug || "",
    note: entry?.note || "",
  };
}

function groupModelCount(groupId: string, models: ModelGroupModel[]): number {
  return models.filter((item) => item.groupId === groupId && item.enabled).length;
}

function groupUserCount(groupId: string, assignments: { groupId: string }[]): number {
  return assignments.filter((item) => item.groupId === groupId).length;
}

export default function ModelGroupsPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { data: session } = useAppSession();
  const isAdminMode = isAdminRole(session?.role);
  const isPageActive = useDesktopPageActive("/model-groups/");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<ModelGroup | null>(null);
  const [groupDraft, setGroupDraft] = useState({
    name: "",
    description: "",
    status: "active",
    sort: "0",
    rateMultiplier: "1",
    isDefault: false,
  });
  const [modelDrafts, setModelDrafts] = useState<Record<string, ModelDraft>>({});
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);

  const groupsQuery = useQuery({
    queryKey: QUERY_KEYS.groups,
    queryFn: () => appClient.listModelGroups(),
    enabled: isAdminMode && isPageActive,
  });
  const modelsQuery = useQuery({
    queryKey: QUERY_KEYS.models,
    queryFn: () => accountClient.listManagedModels(false),
    enabled: isAdminMode && isPageActive,
  });
  const usersQuery = useQuery({
    queryKey: QUERY_KEYS.users,
    queryFn: () => appClient.listAppUsers(),
    enabled: isAdminMode && isPageActive,
  });

  usePageTransitionReady(
    "/model-groups/",
    !isAdminMode || groupsQuery.isFetched || groupsQuery.isError || !isPageActive,
  );

  const groups = groupsQuery.data?.groups ?? [];
  const groupModels = groupsQuery.data?.models ?? [];
  const userAssignments = groupsQuery.data?.userAssignments ?? [];
  const catalogModels = modelsQuery.data?.items ?? [];
  const memberUsers = useMemo(() => activeMemberUsers(usersQuery.data ?? []), [usersQuery.data]);
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? groups[0] ?? null;

  useEffect(() => {
    if (!selectedGroup && selectedGroupId) {
      setSelectedGroupId("");
      return;
    }
    if (!selectedGroupId && groups[0]) {
      setSelectedGroupId(groups[0].id);
    }
  }, [groups, selectedGroup, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroup) return;
    const bySlug = new Map(
      groupModels
        .filter((item) => item.groupId === selectedGroup.id)
        .map((item) => [item.platformModelSlug, item]),
    );
    const nextDrafts: Record<string, ModelDraft> = {};
    for (const model of catalogModels) {
      nextDrafts[model.slug] = modelDraftFromEntry(bySlug.get(model.slug));
    }
    setModelDrafts(nextDrafts);
    setSelectedUserIds(
      userAssignments
        .filter((item) => item.groupId === selectedGroup.id && item.status === "active")
        .map((item) => item.userId),
    );
  }, [catalogModels, groupModels, selectedGroup, userAssignments]);

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.groups }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.models }),
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.users }),
    ]);
  };

  const saveGroup = useMutation({
    mutationFn: async () =>
      appClient.saveModelGroup({
        id: editingGroup?.id ?? null,
        name: groupDraft.name.trim(),
        description: groupDraft.description.trim() || null,
        status: groupDraft.status,
        sort: Number.parseInt(groupDraft.sort, 10) || 0,
        isDefault: groupDraft.isDefault,
        rateMultiplierMillis: parseMultiplier(groupDraft.rateMultiplier) ?? 1000,
      }),
    onSuccess: async (group) => {
      setSelectedGroupId(group.id);
      setGroupDialogOpen(false);
      await refreshAll();
      toast.success(t("模型组已保存"));
    },
    onError: (error) => toast.error(`${t("保存失败")}: ${getAppErrorMessage(error)}`),
  });

  const deleteGroup = useMutation({
    mutationFn: (id: string) => appClient.deleteModelGroup(id),
    onSuccess: async () => {
      await refreshAll();
      toast.success(t("模型组已删除"));
    },
    onError: (error) => toast.error(`${t("删除失败")}: ${getAppErrorMessage(error)}`),
  });

  const saveModels = useMutation({
    mutationFn: async () => {
      if (!selectedGroup) throw new Error("请选择模型组");
      return appClient.setModelGroupModels({
        groupId: selectedGroup.id,
        models: catalogModels
          .map((model) => {
            const draft = modelDrafts[model.slug] ?? modelDraftFromEntry();
            if (!draft.enabled) return null;
            return {
              platformModelSlug: model.slug,
              enabled: true,
              rateMultiplierMillis: parseMultiplier(draft.rateMultiplier),
              billingModelSlug: draft.billingModelSlug.trim() || null,
              note: draft.note.trim() || null,
            };
          })
          .filter(Boolean) as Array<{
          platformModelSlug: string;
          enabled: boolean;
          rateMultiplierMillis: number | null;
          billingModelSlug: string | null;
          note: string | null;
        }>,
      });
    },
    onSuccess: async () => {
      await refreshAll();
      toast.success(t("模型权限已保存"));
    },
    onError: (error) => toast.error(`${t("保存失败")}: ${getAppErrorMessage(error)}`),
  });

  const saveUsers = useMutation({
    mutationFn: async () => {
      if (!selectedGroup) throw new Error("请选择模型组");
      return appClient.setModelGroupUsers({
        groupId: selectedGroup.id,
        userIds: selectedUserIds,
      });
    },
    onSuccess: async () => {
      await refreshAll();
      toast.success(t("成员分配已保存"));
    },
    onError: (error) => toast.error(`${t("保存失败")}: ${getAppErrorMessage(error)}`),
  });

  const openCreateDialog = () => {
    setEditingGroup(null);
    setGroupDraft({
      name: "",
      description: "",
      status: "active",
      sort: String(groups.length),
      rateMultiplier: "1",
      isDefault: false,
    });
    setGroupDialogOpen(true);
  };

  const openEditDialog = (group: ModelGroup) => {
    setEditingGroup(group);
    setGroupDraft({
      name: group.name,
      description: group.description || "",
      status: group.status,
      sort: String(group.sort),
      rateMultiplier: multiplierToText(group.rateMultiplierMillis) || "1",
      isDefault: group.isDefault,
    });
    setGroupDialogOpen(true);
  };

  const toggleUser = (userId: string, checked: boolean) => {
    setSelectedUserIds((current) =>
      checked ? Array.from(new Set(current.concat(userId))) : current.filter((id) => id !== userId),
    );
  };

  if (!isAdminMode) {
    return (
      <div className="container mx-auto p-6">
        <Card className="glass-card">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {t("只有管理员可以管理模型组")}
          </CardContent>
        </Card>
      </div>
    );
  }

  const isRefreshing = groupsQuery.isFetching || modelsQuery.isFetching || usersQuery.isFetching;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-normal">{t("模型组")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("按用户分配可用平台模型，并为不同订阅层配置扣费倍率。")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="glass-card h-10 gap-2 rounded-xl px-3 shadow-sm"
            disabled={isRefreshing}
            onClick={() => void refreshAll()}
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            {t("刷新")}
          </Button>
          <Button className="h-10 gap-2 rounded-xl px-3" onClick={openCreateDialog}>
            <Plus className="h-4 w-4" />
            {t("新建模型组")}
          </Button>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[360px_minmax(0,1fr)]">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-base">{t("组列表")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {groupsQuery.isLoading ? (
              <div className="py-8 text-center text-sm text-muted-foreground">{t("加载中...")}</div>
            ) : groups.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                {t("暂无模型组")}
              </div>
            ) : (
              groups.map((group) => (
                <button
                  key={group.id}
                  type="button"
                  className={cn(
                    "w-full rounded-lg border px-4 py-3 text-left transition",
                    selectedGroup?.id === group.id
                      ? "border-primary bg-primary/10"
                      : "border-border/60 bg-background/40 hover:bg-background/70",
                  )}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{group.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {groupModelCount(group.id, groupModels)} {t("个模型")} ·{" "}
                        {groupUserCount(group.id, userAssignments)} {t("个成员")} ·{" "}
                        {multiplierToText(group.rateMultiplierMillis) || "1"}x
                      </div>
                    </div>
                    {group.isDefault ? <Badge variant="secondary">{t("默认")}</Badge> : null}
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        <div className="space-y-5">
          <Card className="glass-card">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {selectedGroup?.name || t("模型组详情")}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  {selectedGroup?.description || t("选择左侧模型组后配置模型与成员")}
                </p>
              </div>
              {selectedGroup ? (
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => openEditDialog(selectedGroup)}>
                    <PencilLine className="mr-2 h-4 w-4" />
                    {t("编辑")}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={selectedGroup.isDefault || deleteGroup.isPending}
                    onClick={() => {
                      if (window.confirm(t("确认删除该模型组？"))) {
                        deleteGroup.mutate(selectedGroup.id);
                      }
                    }}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t("删除")}
                  </Button>
                </div>
              ) : null}
            </CardHeader>
          </Card>

          {selectedGroup ? (
            <div className="grid gap-5 2xl:grid-cols-[minmax(0,1fr)_360px]">
              <Card className="glass-card">
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <CardTitle className="text-base">{t("可用模型")}</CardTitle>
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={saveModels.isPending}
                    onClick={() => saveModels.mutate()}
                  >
                    <Save className="h-4 w-4" />
                    {t("保存模型")}
                  </Button>
                </CardHeader>
                <CardContent>
                  <div className="overflow-x-auto rounded-lg border border-border/60">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-[72px]">{t("启用")}</TableHead>
                          <TableHead>{t("平台模型")}</TableHead>
                          <TableHead className="w-[120px]">{t("倍率")}</TableHead>
                          <TableHead className="w-[180px]">{t("计费模型")}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {catalogModels.map((model: ManagedModelInfo) => {
                          const draft = modelDrafts[model.slug] ?? modelDraftFromEntry();
                          return (
                            <TableRow key={model.slug}>
                              <TableCell>
                                <Checkbox
                                  checked={draft.enabled}
                                  onCheckedChange={(checked) =>
                                    setModelDrafts((current) => ({
                                      ...current,
                                      [model.slug]: {
                                        ...draft,
                                        enabled: checked === true,
                                      },
                                    }))
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <div className="font-mono text-sm">{model.slug}</div>
                                <div className="text-xs text-muted-foreground">
                                  {model.displayName}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={draft.rateMultiplier}
                                  placeholder={multiplierToText(selectedGroup.rateMultiplierMillis) || "1"}
                                  onChange={(event) =>
                                    setModelDrafts((current) => ({
                                      ...current,
                                      [model.slug]: {
                                        ...draft,
                                        rateMultiplier: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </TableCell>
                              <TableCell>
                                <Input
                                  value={draft.billingModelSlug}
                                  placeholder={model.slug}
                                  onChange={(event) =>
                                    setModelDrafts((current) => ({
                                      ...current,
                                      [model.slug]: {
                                        ...draft,
                                        billingModelSlug: event.target.value,
                                      },
                                    }))
                                  }
                                />
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-card">
                <CardHeader className="flex flex-row items-center justify-between gap-3">
                  <CardTitle className="text-base">{t("成员")}</CardTitle>
                  <Button
                    size="sm"
                    className="gap-2"
                    disabled={saveUsers.isPending}
                    onClick={() => saveUsers.mutate()}
                  >
                    <Check className="h-4 w-4" />
                    {t("保存成员")}
                  </Button>
                </CardHeader>
                <CardContent className="space-y-2">
                  {memberUsers.length === 0 ? (
                    <div className="py-8 text-center text-sm text-muted-foreground">
                      {t("暂无可分配成员")}
                    </div>
                  ) : (
                    memberUsers.map((user) => (
                      <label
                        key={user.id}
                        className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/40 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">
                            {user.displayName || user.username}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {user.username}
                          </div>
                        </div>
                        <Checkbox
                          checked={selectedUserIds.includes(user.id)}
                          onCheckedChange={(checked) => toggleUser(user.id, checked === true)}
                        />
                      </label>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          ) : null}
        </div>
      </div>

      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingGroup ? t("编辑模型组") : t("新建模型组")}</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              saveGroup.mutate();
            }}
          >
            <div className="space-y-2">
              <Label htmlFor="model-group-name">{t("名称")}</Label>
              <Input
                id="model-group-name"
                value={groupDraft.name}
                onChange={(event) =>
                  setGroupDraft((current) => ({ ...current, name: event.target.value }))
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="model-group-description">{t("描述")}</Label>
              <Textarea
                id="model-group-description"
                value={groupDraft.description}
                onChange={(event) =>
                  setGroupDraft((current) => ({ ...current, description: event.target.value }))
                }
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="model-group-rate">{t("默认倍率")}</Label>
                <Input
                  id="model-group-rate"
                  value={groupDraft.rateMultiplier}
                  onChange={(event) =>
                    setGroupDraft((current) => ({
                      ...current,
                      rateMultiplier: event.target.value,
                    }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-group-sort">{t("排序")}</Label>
                <Input
                  id="model-group-sort"
                  value={groupDraft.sort}
                  onChange={(event) =>
                    setGroupDraft((current) => ({ ...current, sort: event.target.value }))
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model-group-status">{t("状态")}</Label>
                <select
                  id="model-group-status"
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={groupDraft.status}
                  onChange={(event) =>
                    setGroupDraft((current) => ({ ...current, status: event.target.value }))
                  }
                >
                  <option value="active">{t("启用")}</option>
                  <option value="disabled">{t("禁用")}</option>
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={groupDraft.isDefault}
                onCheckedChange={(checked) =>
                  setGroupDraft((current) => ({ ...current, isDefault: checked === true }))
                }
              />
              {t("设为新成员默认模型组")}
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setGroupDialogOpen(false)}>
                {t("取消")}
              </Button>
              <Button type="submit" disabled={saveGroup.isPending}>
                {t("保存")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
