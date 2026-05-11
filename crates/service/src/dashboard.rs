use std::collections::{BTreeMap, HashMap, HashSet};

use codexmanager_core::rpc::types::{
    ApiKeySummary, MemberDashboardAlert, MemberDashboardApiKeySummary, MemberDashboardKeyUsage,
    MemberDashboardModelUsage, MemberDashboardSummaryResult, MemberDashboardUsagePoint,
    MemberDashboardUsageToday, MemberDashboardWalletResult, ModelInfo, RequestLogListParams,
};
use serde_json::json;

use crate::{
    apikey_list, apikey_models, quota::model_pricing, requestlog_list, requestlog_summary,
    requestlog_today_summary, storage_helpers, RpcActor,
};

const TREND_DAYS: i64 = 7;
const MEMBER_TOP_KEY_LIMIT: usize = 8;
const MEMBER_TOP_MODEL_LIMIT: usize = 6;
const MEMBER_RECENT_LOG_LIMIT: i64 = 8;
const LOW_WALLET_CREDIT_MICROS: i64 = 1_000_000;

pub(crate) fn read_member_dashboard_summary(
    actor: &RpcActor,
    requested_user_id: Option<String>,
    day_start_ts: Option<i64>,
    day_end_ts: Option<i64>,
) -> Result<MemberDashboardSummaryResult, String> {
    crate::initialize_storage_if_needed()?;
    let distribution_enabled = crate::distribution_enabled();
    let target_user_id = resolve_target_user_id(actor, requested_user_id)?;
    let (day_start, day_end) = resolve_day_bounds(day_start_ts, day_end_ts);

    let Some(user_id) = target_user_id else {
        return Ok(empty_summary(
            None,
            distribution_enabled,
            vec![MemberDashboardAlert {
                kind: "no_user".to_string(),
                severity: "info".to_string(),
                title: "未选择成员".to_string(),
                message: "管理员调试普通用户仪表盘时需要指定成员。".to_string(),
                action_label: Some("账号管理".to_string()),
                action_href: Some("/account-manager/".to_string()),
            }],
        ));
    };

    let key_ids = crate::list_api_key_ids_for_user(&user_id)?;
    let key_id_set = key_ids.iter().cloned().collect::<HashSet<_>>();
    let api_keys = apikey_list::read_api_keys()?
        .into_iter()
        .filter(|key| key_id_set.contains(&key.id))
        .collect::<Vec<_>>();
    let api_key_summary = build_api_key_summary(&api_keys);
    let wallet = read_member_wallet(&user_id)?;

    let today_tokens = requestlog_today_summary::read_requestlog_today_summary_for_key_ids(
        Some(day_start),
        Some(day_end),
        &key_ids,
    )?;
    let today_log_summary = requestlog_summary::read_request_log_filter_summary_for_key_ids(
        RequestLogListParams {
            page: 1,
            page_size: 20,
            query: None,
            status_filter: Some("all".to_string()),
            start_ts: Some(day_start),
            end_ts: Some(day_end),
        },
        &key_ids,
    )?;
    let usage_today = MemberDashboardUsageToday {
        input_tokens: today_tokens.input_tokens,
        cached_input_tokens: today_tokens.cached_input_tokens,
        output_tokens: today_tokens.output_tokens,
        reasoning_output_tokens: today_tokens.reasoning_output_tokens,
        total_tokens: today_tokens.today_tokens,
        estimated_cost_usd: today_tokens.estimated_cost,
        total_count: today_log_summary.total_count,
        success_count: today_log_summary.success_count,
        error_count: today_log_summary.error_count,
        success_rate: (today_log_summary.total_count > 0)
            .then(|| today_log_summary.success_count as f64 / today_log_summary.total_count as f64),
    };

    let usage_trend_7d = read_usage_trend_7d(day_start, day_end, &key_ids)?;
    let (top_keys, top_models) =
        read_member_usage_breakdown(&api_keys, &key_id_set, day_start, day_end)?;
    let available_models = read_available_models_with_price_summary()?;
    let recent_logs = requestlog_list::read_request_log_page_for_key_ids(
        RequestLogListParams {
            page: 1,
            page_size: MEMBER_RECENT_LOG_LIMIT,
            query: None,
            status_filter: Some("all".to_string()),
            start_ts: None,
            end_ts: None,
        },
        &key_ids,
    )?
    .items;
    let alerts = build_alerts(
        distribution_enabled,
        wallet.as_ref(),
        &api_key_summary,
        &usage_today,
        available_models.len(),
    );

    Ok(MemberDashboardSummaryResult {
        user_id: Some(user_id),
        distribution_enabled,
        wallet,
        api_key_summary,
        usage_today,
        usage_trend_7d,
        top_keys,
        top_models,
        available_models,
        recent_logs,
        alerts,
    })
}

fn resolve_target_user_id(
    actor: &RpcActor,
    requested_user_id: Option<String>,
) -> Result<Option<String>, String> {
    if actor.is_admin() {
        return Ok(requested_user_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| actor.user_id.clone()));
    }
    actor
        .user_id
        .as_ref()
        .map(|value| Some(value.clone()))
        .ok_or_else(|| "permission_denied: dashboard requires user session".to_string())
}

fn resolve_day_bounds(day_start_ts: Option<i64>, day_end_ts: Option<i64>) -> (i64, i64) {
    match (
        day_start_ts.filter(|value| *value > 0),
        day_end_ts.filter(|value| *value > 0),
    ) {
        (Some(start), Some(end)) if end > start => (start, end),
        _ => {
            let now = codexmanager_core::storage::now_ts();
            let start = now - now.rem_euclid(24 * 60 * 60);
            (start, start + 24 * 60 * 60)
        }
    }
}

fn empty_summary(
    user_id: Option<String>,
    distribution_enabled: bool,
    alerts: Vec<MemberDashboardAlert>,
) -> MemberDashboardSummaryResult {
    MemberDashboardSummaryResult {
        user_id,
        distribution_enabled,
        alerts,
        ..MemberDashboardSummaryResult::default()
    }
}

fn read_member_wallet(user_id: &str) -> Result<Option<MemberDashboardWalletResult>, String> {
    let storage =
        storage_helpers::open_storage().ok_or_else(|| "open storage failed".to_string())?;
    let wallet = storage
        .find_wallet_by_owner("user", user_id)
        .map_err(|err| format!("read app wallet failed: {err}"))?;
    Ok(wallet.map(|wallet| MemberDashboardWalletResult {
        id: wallet.id,
        balance_credit_micros: wallet.balance_credit_micros,
        frozen_credit_micros: wallet.frozen_credit_micros,
        available_credit_micros: wallet
            .balance_credit_micros
            .saturating_sub(wallet.frozen_credit_micros),
        status: wallet.status,
        updated_at: wallet.updated_at,
    }))
}

fn read_available_models_with_price_summary() -> Result<Vec<ModelInfo>, String> {
    let storage =
        storage_helpers::open_storage().ok_or_else(|| "open storage failed".to_string())?;
    let price_rules = model_pricing::load_enabled_price_rules(&storage)?;
    Ok(apikey_models::read_model_options(false)?
        .models
        .into_iter()
        .filter(|model| model.supported_in_api && model.visibility.as_deref() != Some("hide"))
        .map(|mut model| {
            if let Some(price) =
                model_pricing::resolve_model_price_from_rules(&price_rules, &model.slug, 0)
                    .or_else(|| model_pricing::resolve_model_price(&model.slug, 0))
            {
                model.extra.insert(
                    "priceSummary".to_string(),
                    json!({
                        "provider": price.provider,
                        "inputUsdPer1M": price.input_price_per_1m,
                        "cachedInputUsdPer1M": price.cached_input_price_per_1m,
                        "outputUsdPer1M": price.output_price_per_1m,
                    }),
                );
            }
            model
        })
        .collect())
}

fn build_api_key_summary(api_keys: &[ApiKeySummary]) -> MemberDashboardApiKeySummary {
    let enabled_count = api_keys
        .iter()
        .filter(|key| {
            let status = key.status.trim().to_ascii_lowercase();
            status == "enabled" || status == "active"
        })
        .count() as i64;
    MemberDashboardApiKeySummary {
        total_count: api_keys.len() as i64,
        enabled_count,
        disabled_count: api_keys.len() as i64 - enabled_count,
        last_used_at: api_keys.iter().filter_map(|key| key.last_used_at).max(),
    }
}

fn read_usage_trend_7d(
    day_start: i64,
    day_end: i64,
    key_ids: &[String],
) -> Result<Vec<MemberDashboardUsagePoint>, String> {
    let storage =
        storage_helpers::open_storage().ok_or_else(|| "open storage failed".to_string())?;
    let day_span = (day_end - day_start).max(1);
    let mut points = Vec::new();
    for offset in (0..TREND_DAYS).rev() {
        let start = day_start.saturating_sub(offset * day_span);
        let end = start.saturating_add(day_span);
        let summary = storage
            .summarize_request_logs_between_for_keys(start, end, key_ids)
            .map_err(|err| format!("summarize request logs failed: {err}"))?;
        let total_tokens = summary
            .input_tokens
            .saturating_sub(summary.cached_input_tokens)
            .saturating_add(summary.output_tokens)
            .max(0);
        points.push(MemberDashboardUsagePoint {
            day_start_ts: start,
            day_end_ts: end,
            total_tokens,
            estimated_cost_usd: summary.estimated_cost_usd.max(0.0),
        });
    }
    Ok(points)
}

fn read_member_usage_breakdown(
    api_keys: &[ApiKeySummary],
    key_id_set: &HashSet<String>,
    day_start: i64,
    day_end: i64,
) -> Result<(Vec<MemberDashboardKeyUsage>, Vec<MemberDashboardModelUsage>), String> {
    let storage =
        storage_helpers::open_storage().ok_or_else(|| "open storage failed".to_string())?;
    let today_usage = storage
        .summarize_request_token_stats_by_key_and_model(Some(day_start), Some(day_end))
        .map_err(|err| format!("summarize today key usage failed: {err}"))?;
    let total_usage = storage
        .summarize_request_token_stats_by_key()
        .map_err(|err| format!("summarize key usage failed: {err}"))?;
    let seven_day_usage = storage
        .summarize_request_token_stats_by_key_and_model(
            Some(day_start.saturating_sub((TREND_DAYS - 1) * (day_end - day_start).max(1))),
            Some(day_end),
        )
        .map_err(|err| format!("summarize model usage failed: {err}"))?;

    let mut today_by_key: HashMap<String, (i64, f64)> = HashMap::new();
    for item in today_usage
        .into_iter()
        .filter(|item| key_id_set.contains(&item.key_id))
    {
        let entry = today_by_key.entry(item.key_id).or_insert((0, 0.0));
        entry.0 = entry.0.saturating_add(item.total_tokens.max(0));
        entry.1 += item.estimated_cost_usd.max(0.0);
    }

    let total_by_key = total_usage
        .into_iter()
        .filter(|item| key_id_set.contains(&item.key_id))
        .map(|item| {
            (
                item.key_id,
                (item.total_tokens.max(0), item.estimated_cost_usd.max(0.0)),
            )
        })
        .collect::<HashMap<_, _>>();

    let mut top_keys = api_keys
        .iter()
        .map(|key| {
            let (today_tokens, today_cost_usd) =
                today_by_key.get(&key.id).copied().unwrap_or((0, 0.0));
            let (total_tokens, total_cost_usd) =
                total_by_key.get(&key.id).copied().unwrap_or((0, 0.0));
            MemberDashboardKeyUsage {
                key_id: key.id.clone(),
                name: key.name.clone(),
                model_slug: key.model_slug.clone(),
                status: key.status.clone(),
                today_tokens,
                today_cost_usd,
                total_tokens,
                total_cost_usd,
                last_used_at: key.last_used_at,
            }
        })
        .collect::<Vec<_>>();
    top_keys.sort_by(|a, b| {
        b.today_tokens
            .cmp(&a.today_tokens)
            .then_with(|| b.last_used_at.cmp(&a.last_used_at))
            .then_with(|| a.key_id.cmp(&b.key_id))
    });
    top_keys.truncate(MEMBER_TOP_KEY_LIMIT);

    let mut model_usage = BTreeMap::<String, (i64, f64)>::new();
    for item in seven_day_usage
        .into_iter()
        .filter(|item| key_id_set.contains(&item.key_id))
    {
        let entry = model_usage.entry(item.model).or_insert((0, 0.0));
        entry.0 = entry.0.saturating_add(item.total_tokens.max(0));
        entry.1 += item.estimated_cost_usd.max(0.0);
    }
    let mut top_models = model_usage
        .into_iter()
        .map(
            |(model, (total_tokens, estimated_cost_usd))| MemberDashboardModelUsage {
                model,
                total_tokens,
                estimated_cost_usd,
            },
        )
        .collect::<Vec<_>>();
    top_models.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then_with(|| a.model.cmp(&b.model))
    });
    top_models.truncate(MEMBER_TOP_MODEL_LIMIT);

    Ok((top_keys, top_models))
}

fn build_alerts(
    distribution_enabled: bool,
    wallet: Option<&MemberDashboardWalletResult>,
    api_key_summary: &MemberDashboardApiKeySummary,
    usage_today: &MemberDashboardUsageToday,
    available_model_count: usize,
) -> Vec<MemberDashboardAlert> {
    let mut alerts = Vec::new();
    if api_key_summary.total_count == 0 {
        alerts.push(MemberDashboardAlert {
            kind: "no_api_key".to_string(),
            severity: "warning".to_string(),
            title: "还没有平台 Key".to_string(),
            message: "创建一个平台 Key 后就可以通过网关调用可用模型。".to_string(),
            action_label: Some("创建 Key".to_string()),
            action_href: Some("/apikeys/".to_string()),
        });
    } else if api_key_summary.enabled_count == 0 {
        alerts.push(MemberDashboardAlert {
            kind: "no_enabled_key".to_string(),
            severity: "warning".to_string(),
            title: "平台 Key 均已停用".to_string(),
            message: "至少启用一个平台 Key 才能继续发起请求。".to_string(),
            action_label: Some("平台密钥".to_string()),
            action_href: Some("/apikeys/".to_string()),
        });
    }

    if distribution_enabled {
        match wallet {
            Some(wallet) if wallet.available_credit_micros <= 0 => {
                alerts.push(MemberDashboardAlert {
                    kind: "wallet_empty".to_string(),
                    severity: "critical".to_string(),
                    title: "钱包余额不足".to_string(),
                    message: "当前余额已不可用，请联系管理员充值。".to_string(),
                    action_label: Some("账号设置".to_string()),
                    action_href: Some("/settings/".to_string()),
                })
            }
            Some(wallet) if wallet.available_credit_micros < LOW_WALLET_CREDIT_MICROS => {
                alerts.push(MemberDashboardAlert {
                    kind: "wallet_low".to_string(),
                    severity: "warning".to_string(),
                    title: "钱包余额偏低".to_string(),
                    message: "余额低于 $1，额度较快耗尽时请求可能被拦截。".to_string(),
                    action_label: Some("账号设置".to_string()),
                    action_href: Some("/settings/".to_string()),
                });
            }
            None => alerts.push(MemberDashboardAlert {
                kind: "wallet_missing".to_string(),
                severity: "warning".to_string(),
                title: "钱包未初始化".to_string(),
                message: "当前账号还没有可用钱包，请联系管理员检查账号配置。".to_string(),
                action_label: Some("账号设置".to_string()),
                action_href: Some("/settings/".to_string()),
            }),
            _ => {}
        }
    }

    if available_model_count == 0 {
        alerts.push(MemberDashboardAlert {
            kind: "no_available_model".to_string(),
            severity: "critical".to_string(),
            title: "暂无可用模型".to_string(),
            message: "当前没有对 API 开放的模型，请联系管理员检查模型目录。".to_string(),
            action_label: Some("模型管理".to_string()),
            action_href: Some("/models/".to_string()),
        });
    }

    if usage_today.total_count >= 5
        && usage_today.error_count.saturating_mul(100) >= usage_today.total_count * 20
    {
        alerts.push(MemberDashboardAlert {
            kind: "high_failure_rate".to_string(),
            severity: "warning".to_string(),
            title: "今日失败率偏高".to_string(),
            message: "最近请求出现较多失败，可以到请求日志查看错误原因。".to_string(),
            action_label: Some("请求日志".to_string()),
            action_href: Some("/logs/".to_string()),
        });
    }

    alerts
}
