"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  UserPlus,
  UsersRound,
  WalletCards,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useDeferredDesktopActivation } from "@/hooks/useDeferredDesktopActivation";
import { useDesktopPageActive } from "@/hooks/useDesktopPageActive";
import { usePageTransitionReady } from "@/hooks/usePageTransitionReady";
import { useRuntimeCapabilities } from "@/hooks/useRuntimeCapabilities";
import { appClient } from "@/lib/api/app-client";
import { getAppErrorMessage } from "@/lib/api/transport";
import { useI18n } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";
import type { AccountManagerStatus, AppUser } from "@/types";

const ACCOUNT_MANAGER_QUERY_KEYS = {
  status: ["account-manager", "status"] as const,
  users: ["account-manager", "users"] as const,
};

const CREDIT_MICROS_PER_USD = 1_000_000;

function formatCreditMicros(value: number | null | undefined): string {
  const normalized =
    typeof value === "number" && Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(normalized / CREDIT_MICROS_PER_USD);
}

function parseCreditInput(value: string): number | null {
  const normalized = Number(String(value || "").trim());
  if (!Number.isFinite(normalized) || normalized < 0) {
    return null;
  }
  return Math.round(normalized * CREDIT_MICROS_PER_USD);
}

function formatTime(value: number | null | undefined): string {
  if (!value) return "从未";
  const date = new Date(value * 1000);
  if (Number.isNaN(date.getTime())) return "未知";
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "accounts":
      return "账号登录";
    case "password":
      return "共享密码";
    case "none":
      return "未开启";
    default:
      return mode || "未知";
  }
}

function roleLabel(role: string): string {
  return role === "admin" ? "管理员" : "成员";
}

function isAdminUser(user: AppUser): boolean {
  return user.role === "admin";
}

function userCanOwnWallet(user: AppUser): boolean {
  return !isAdminUser(user);
}

function statusLabel(status: string): string {
  return status === "active" ? "启用" : status || "未知";
}

function userSelectLabel(user: AppUser | null | undefined): string {
  if (!user) return "选择可分发成员";
  return user.displayName ? `${user.displayName} (${user.username})` : user.username;
}

function StatCard({
  title,
  value,
  detail,
  icon: Icon,
}: {
  title: string;
  value: string;
  detail: string;
  icon: typeof ShieldCheck;
}) {
  return (
    <Card className="glass-card border-none shadow-sm">
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="space-y-1">
          <CardDescription>{title}</CardDescription>
          <CardTitle className="text-2xl">{value}</CardTitle>
        </div>
        <div className="rounded-lg bg-primary/10 p-2 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

export default function AccountManagerPage() {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const { canAccessManagementRpc } = useRuntimeCapabilities();
  const isPageActive = useDesktopPageActive("/account-manager/");
  const shouldQuery =
    useDeferredDesktopActivation(canAccessManagementRpc) && isPageActive;
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [topUpUserId, setTopUpUserId] = useState<string | null>(null);
  const [createDraft, setCreateDraft] = useState({
    username: "",
    displayName: "",
    password: "",
    role: "member",
    initialBalance: "0",
  });
  const [topUpDraft, setTopUpDraft] = useState({
    amount: "1",
    note: "",
  });

  const statusQuery = useQuery<AccountManagerStatus>({
    queryKey: ACCOUNT_MANAGER_QUERY_KEYS.status,
    queryFn: () => appClient.getAccountManagerStatus(),
    enabled: shouldQuery,
  });
  const usersQuery = useQuery<AppUser[]>({
    queryKey: ACCOUNT_MANAGER_QUERY_KEYS.users,
    queryFn: () => appClient.listAppUsers(),
    enabled: shouldQuery,
  });

  usePageTransitionReady(
    "/account-manager/",
    !canAccessManagementRpc ||
      statusQuery.isFetched ||
      statusQuery.isError ||
      !isPageActive,
  );

  const users = usersQuery.data ?? [];
  const usersById = useMemo(
    () => new Map(users.map((user) => [user.id, user])),
    [users],
  );
  const walletUsers = useMemo(
    () => users.filter((user) => userCanOwnWallet(user)),
    [users],
  );
  const status = statusQuery.data;
  const topUpUser = topUpUserId ? usersById.get(topUpUserId) ?? null : null;

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ACCOUNT_MANAGER_QUERY_KEYS.status,
      }),
      queryClient.invalidateQueries({
        queryKey: ACCOUNT_MANAGER_QUERY_KEYS.users,
      }),
      queryClient.invalidateQueries({
        queryKey: ["account-manager", "api-key-owners"],
      }),
    ]);
  };

  const createUser = useMutation({
    mutationFn: async () => {
      const username = createDraft.username.trim();
      const password = createDraft.password;
      if (!username) throw new Error("请输入用户名");
      if (!password) throw new Error("请输入初始密码");
      const creatingAdmin = createDraft.role === "admin";
      const initialBalanceCreditMicros = creatingAdmin
        ? null
        : parseCreditInput(createDraft.initialBalance);
      if (!creatingAdmin && initialBalanceCreditMicros === null) {
        throw new Error("初始额度必须是非负数字");
      }
      return appClient.createAppUser({
        username,
        password,
        displayName: createDraft.displayName.trim() || null,
        role: createDraft.role,
        initialBalanceCreditMicros,
      });
    },
    onSuccess: async () => {
      setCreateDraft({
        username: "",
        displayName: "",
        password: "",
        role: "member",
        initialBalance: "0",
      });
      setCreateDialogOpen(false);
      await refreshAll();
      toast.success(t("账号已创建"));
    },
    onError: (error: unknown) => {
      toast.error(`${t("创建失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const topUpWallet = useMutation({
    mutationFn: async () => {
      if (!topUpUser || !userCanOwnWallet(topUpUser)) {
        throw new Error("请选择可分发成员");
      }
      const amountCreditMicros = parseCreditInput(topUpDraft.amount);
      if (!amountCreditMicros || amountCreditMicros <= 0) {
        throw new Error("充值额度必须大于 0");
      }
      return appClient.topUpWallet({
        ownerKind: "user",
        ownerId: topUpUser.id,
        amountCreditMicros,
        note: topUpDraft.note.trim() || null,
      });
    },
    onSuccess: async () => {
      setTopUpUserId(null);
      setTopUpDraft({ amount: "1", note: "" });
      await refreshAll();
      toast.success(t("钱包已充值"));
    },
    onError: (error: unknown) => {
      toast.error(`${t("充值失败")}: ${getAppErrorMessage(error)}`);
    },
  });

  const handleCreateUser = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createUser.mutate();
  };

  const handleTopUp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    topUpWallet.mutate();
  };

  const openTopUpDialog = (user: AppUser) => {
    setTopUpUserId(user.id);
    setTopUpDraft({ amount: "1", note: "" });
  };

  const isRefreshing = statusQuery.isFetching || usersQuery.isFetching;

  return (
    <div className="container mx-auto space-y-6 p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t("账号管理")}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {t("管理 Web 登录成员和额度分发钱包。平台 Key 归属在平台密钥中配置。")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            className="glass-card h-10 gap-2 rounded-xl px-3 shadow-sm"
            disabled={!canAccessManagementRpc || isRefreshing}
            onClick={() => void refreshAll()}
          >
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            {t("刷新")}
          </Button>
          <Button
            className="h-10 gap-2 shadow-lg shadow-primary/20"
            disabled={!canAccessManagementRpc}
            onClick={() => setCreateDialogOpen(true)}
          >
            <Plus className="h-4 w-4" />
            {t("新建账号")}
          </Button>
        </div>
      </div>

      {!canAccessManagementRpc ? (
        <Card className="glass-card border-none shadow-md">
          <CardContent className="flex items-start gap-3 py-5">
            <AlertCircle className="mt-0.5 h-5 w-5 text-destructive" />
            <div className="space-y-1">
              <p className="font-medium">{t("当前 Web 运行方式不受支持")}</p>
              <p className="text-sm text-muted-foreground">
                {t("请通过 CodexManager Web 运行壳访问账号管理。")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          title={t("登录模式")}
          value={modeLabel(status?.mode || "none")}
          detail={
            status?.appUsersConfigured
              ? t("账号系统已初始化")
              : t("账号系统未初始化")
          }
          icon={ShieldCheck}
        />
        <StatCard
          title={t("额度分发")}
          value={status?.distributionEnabled ? t("已开启") : t("未开启")}
          detail={t("开启后平台 Key 会按归属钱包扣减额度")}
          icon={WalletCards}
        />
        <StatCard
          title={t("管理员")}
          value={String(status?.activeAdminCount ?? 0)}
          detail={t("当前启用的管理员账号数量")}
          icon={UsersRound}
        />
        <StatCard
          title={t("可分发成员")}
          value={String(walletUsers.length)}
          detail={t("不包含管理员账号")}
          icon={UserPlus}
        />
      </div>

      <Card className="glass-card overflow-hidden border-none py-0 shadow-xl backdrop-blur-md">
        <CardHeader className="border-b bg-background/35 py-4">
          <CardTitle>{t("登录账号")}</CardTitle>
          <CardDescription>
            {t("管理员只负责控制面管理；成员才参与额度分发和平台 Key 消费。")}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="px-4">{t("用户名")}</TableHead>
                <TableHead>{t("角色")}</TableHead>
                <TableHead>{t("状态")}</TableHead>
                <TableHead>{t("可用额度")}</TableHead>
                <TableHead>{t("最后登录")}</TableHead>
                <TableHead>{t("账号 ID")}</TableHead>
                <TableHead className="pr-4 text-right">{t("操作")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {usersQuery.isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    {t("读取中...")}
                  </TableCell>
                </TableRow>
              ) : users.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-24 text-center text-muted-foreground"
                  >
                    {t("暂无登录账号")}
                  </TableCell>
                </TableRow>
              ) : (
                users.map((user) => (
                  <TableRow key={user.id}>
                    <TableCell className="px-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium">{user.username}</span>
                        {user.displayName ? (
                          <span className="text-xs text-muted-foreground">
                            {user.displayName}
                          </span>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={user.role === "admin" ? "default" : "secondary"}
                      >
                        {roleLabel(user.role)}
                      </Badge>
                    </TableCell>
                    <TableCell>{statusLabel(user.status)}</TableCell>
                    <TableCell>
                      {isAdminUser(user) ? (
                        <Badge variant="outline">{t("不参与分发")}</Badge>
                      ) : (
                        formatCreditMicros(user.wallet?.availableCreditMicros)
                      )}
                    </TableCell>
                    <TableCell>{formatTime(user.lastLoginAt)}</TableCell>
                    <TableCell className="max-w-[180px] truncate font-mono text-xs text-muted-foreground">
                      {user.id}
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canAccessManagementRpc || !userCanOwnWallet(user)}
                        onClick={() => openTopUpDialog(user)}
                      >
                        {t("充值")}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="glass-card border-none sm:max-w-[560px]">
          <DialogHeader>
            <DialogTitle>{t("新建登录账号")}</DialogTitle>
            <DialogDescription>
              {t("成员账号可拥有额度钱包；管理员账号只负责管理。")}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={handleCreateUser}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="app-user-username">{t("用户名")}</Label>
                <Input
                  id="app-user-username"
                  value={createDraft.username}
                  onChange={(event) =>
                    setCreateDraft((draft) => ({
                      ...draft,
                      username: event.target.value,
                    }))
                  }
                  placeholder="member-one"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="app-user-display-name">{t("显示名称")}</Label>
                <Input
                  id="app-user-display-name"
                  value={createDraft.displayName}
                  onChange={(event) =>
                    setCreateDraft((draft) => ({
                      ...draft,
                      displayName: event.target.value,
                    }))
                  }
                  placeholder="Member One"
                />
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="app-user-password">{t("初始密码")}</Label>
              <Input
                id="app-user-password"
                type="password"
                value={createDraft.password}
                onChange={(event) =>
                  setCreateDraft((draft) => ({
                    ...draft,
                    password: event.target.value,
                  }))
                }
                placeholder="password123"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>{t("角色")}</Label>
                <Select
                  value={createDraft.role}
                  onValueChange={(value) =>
                    setCreateDraft((draft) => ({
                      ...draft,
                      role: String(value),
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(value) => roleLabel(String(value || "member"))}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="member">{t("成员")}</SelectItem>
                    <SelectItem value="admin">{t("管理员")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="app-user-initial-balance">{t("初始额度")}</Label>
                <Input
                  id="app-user-initial-balance"
                  inputMode="decimal"
                  value={createDraft.initialBalance}
                  onChange={(event) =>
                    setCreateDraft((draft) => ({
                      ...draft,
                      initialBalance: event.target.value,
                    }))
                  }
                  disabled={createDraft.role === "admin"}
                  placeholder={
                    createDraft.role === "admin" ? t("管理员不设置额度") : "0"
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateDialogOpen(false)}
              >
                {t("取消")}
              </Button>
              <Button
                type="submit"
                className="gap-2"
                disabled={!canAccessManagementRpc || createUser.isPending}
              >
                <UserPlus className="h-4 w-4" />
                {createUser.isPending ? t("创建中...") : t("创建账号")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(topUpUserId)}
        onOpenChange={(open) => {
          if (!open) {
            setTopUpUserId(null);
            setTopUpDraft({ amount: "1", note: "" });
          }
        }}
      >
        <DialogContent className="glass-card border-none sm:max-w-[480px]">
          <DialogHeader>
            <DialogTitle>{t("钱包充值")}</DialogTitle>
            <DialogDescription>
              {topUpUser
                ? `${t("充值账号")}：${userSelectLabel(topUpUser)}`
                : t("选择可分发成员")}
            </DialogDescription>
          </DialogHeader>
          <form className="grid gap-4" onSubmit={handleTopUp}>
            <div className="grid gap-1.5">
              <Label htmlFor="wallet-top-up-amount">{t("充值额度")}</Label>
              <Input
                id="wallet-top-up-amount"
                inputMode="decimal"
                value={topUpDraft.amount}
                onChange={(event) =>
                  setTopUpDraft((draft) => ({
                    ...draft,
                    amount: event.target.value,
                  }))
                }
                placeholder="1"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="wallet-top-up-note">{t("备注")}</Label>
              <Input
                id="wallet-top-up-note"
                value={topUpDraft.note}
                onChange={(event) =>
                  setTopUpDraft((draft) => ({
                    ...draft,
                    note: event.target.value,
                  }))
                }
                placeholder={t("可选")}
              />
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setTopUpUserId(null)}
              >
                {t("取消")}
              </Button>
              <Button
                type="submit"
                className="gap-2"
                disabled={
                  !canAccessManagementRpc ||
                  !topUpUser ||
                  topUpWallet.isPending
                }
              >
                <WalletCards className="h-4 w-4" />
                {topUpWallet.isPending ? t("充值中...") : t("确认充值")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
