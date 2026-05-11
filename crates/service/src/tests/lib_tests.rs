use super::*;
use codexmanager_core::rpc::types::{JsonRpcMessage, JsonRpcResponse};
use codexmanager_core::storage::{RequestLog, RequestTokenStat};

/// 函数 `response_result`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// - resp: 参数 resp
///
/// # 返回
/// 返回函数执行结果
fn response_result(resp: JsonRpcMessage) -> JsonRpcResponse {
    match resp {
        JsonRpcMessage::Response(resp) => resp,
        JsonRpcMessage::Error(err) => panic!("unexpected rpc error: {}", err.error.message),
        JsonRpcMessage::Notification(_) => panic!("unexpected rpc notification"),
        JsonRpcMessage::Request(_) => panic!("unexpected rpc request"),
    }
}

/// 函数 `login_complete_requires_params`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 无
#[test]
fn login_complete_requires_params() {
    let req = JsonRpcRequest {
        id: 1.into(),
        method: "account/login/complete".to_string(),
        params: None,
        trace: None,
    };
    let resp = response_result(handle_request(req));
    let err = resp
        .result
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert!(err.contains("missing"));

    let req = JsonRpcRequest {
        id: 2.into(),
        method: "account/login/complete".to_string(),
        params: Some(serde_json::json!({ "code": "x" })),
        trace: None,
    };
    let resp = response_result(handle_request(req));
    let err = resp
        .result
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert!(err.contains("missing"));

    let req = JsonRpcRequest {
        id: 3.into(),
        method: "account/login/complete".to_string(),
        params: Some(serde_json::json!({ "state": "y" })),
        trace: None,
    };
    let resp = response_result(handle_request(req));
    let err = resp
        .result
        .get("error")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    assert!(err.contains("missing"));
}

/// 函数 `unknown_method_returns_jsonrpc_error`
///
/// 作者: gaohongshun
///
/// 时间: 2026-04-02
///
/// # 参数
/// 无
///
/// # 返回
/// 无
#[test]
fn unknown_method_returns_jsonrpc_error() {
    let req = JsonRpcRequest {
        id: 9.into(),
        method: "not/a/method".to_string(),
        params: None,
        trace: None,
    };

    match handle_request(req) {
        JsonRpcMessage::Error(err) => {
            assert_eq!(err.id, 9.into());
            assert_eq!(err.error.code, -32601);
            assert_eq!(err.error.message, "unknown_method");
        }
        other => panic!("expected rpc error, got {other:?}"),
    }
}

#[test]
fn member_actor_cannot_call_admin_only_rpc() {
    let req = JsonRpcRequest {
        id: 21.into(),
        method: "accountManager/users/list".to_string(),
        params: None,
        trace: None,
    };

    let resp = response_result(handle_request_with_actor(
        req,
        RpcActor::from_parts(Some(ROLE_MEMBER), Some("user-1")),
    ));
    let err = resp
        .result
        .get("error")
        .and_then(|value| value.as_str())
        .unwrap_or("");
    assert!(err.contains("permission_denied"));
}

fn setup_dashboard_test_db(name: &str) -> String {
    let db_path = std::env::temp_dir()
        .join(format!(
            "{name}-{}-{}.sqlite",
            std::process::id(),
            codexmanager_core::storage::now_ts()
        ))
        .to_string_lossy()
        .to_string();
    let _ = std::fs::remove_file(&db_path);
    std::env::set_var("CODEXMANAGER_DB_PATH", &db_path);
    storage_helpers::initialize_storage().expect("init storage");
    db_path
}

fn rpc_request(method: &str, params: serde_json::Value) -> JsonRpcRequest {
    JsonRpcRequest {
        id: 31.into(),
        method: method.to_string(),
        params: Some(params),
        trace: None,
    }
}

fn rpc_error(resp: &JsonRpcResponse) -> String {
    resp.result
        .get("error")
        .and_then(|value| value.as_str())
        .unwrap_or("")
        .to_string()
}

fn create_test_member(
    username: &str,
    initial_balance_credit_micros: Option<i64>,
) -> AppUserPublicResult {
    create_app_user(AppUserCreateInput {
        username: username.to_string(),
        password: format!("{username}-password"),
        display_name: None,
        role: Some(ROLE_MEMBER.to_string()),
        initial_balance_credit_micros,
    })
    .expect("create member")
}

fn create_owned_test_api_key(user_id: &str, name: &str, model: &str) -> String {
    let created = apikey_create::create_api_key(
        Some(name.to_string()),
        Some(model.to_string()),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("create api key");
    set_api_key_owner(&created.id, "user", Some(user_id), None).expect("own api key");
    created.id
}

fn insert_test_request_log(
    key_id: &str,
    trace_id: &str,
    model: &str,
    status_code: i64,
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    estimated_cost_usd: f64,
    created_at: i64,
) {
    let total_tokens = input_tokens + output_tokens;
    let storage = storage_helpers::open_storage().expect("open storage");
    storage
        .insert_request_log_with_token_stat(
            &RequestLog {
                trace_id: Some(trace_id.to_string()),
                key_id: Some(key_id.to_string()),
                request_path: "/v1/chat/completions".to_string(),
                method: "POST".to_string(),
                model: Some(model.to_string()),
                status_code: Some(status_code),
                input_tokens: Some(input_tokens),
                cached_input_tokens: Some(cached_input_tokens),
                output_tokens: Some(output_tokens),
                total_tokens: Some(total_tokens),
                estimated_cost_usd: Some(estimated_cost_usd),
                created_at,
                ..RequestLog::default()
            },
            &RequestTokenStat {
                key_id: Some(key_id.to_string()),
                model: Some(model.to_string()),
                input_tokens: Some(input_tokens),
                cached_input_tokens: Some(cached_input_tokens),
                output_tokens: Some(output_tokens),
                total_tokens: Some(total_tokens),
                estimated_cost_usd: Some(estimated_cost_usd),
                created_at,
                ..RequestTokenStat::default()
            },
        )
        .expect("insert request log");
}

#[test]
fn member_dashboard_filters_to_current_user_keys() {
    let _guard = test_env_guard();
    let db_path = setup_dashboard_test_db("codexmanager-member-dashboard-filter");
    let day_start = 1_700_000_000;
    let day_end = day_start + 86_400;
    let user_one = create_app_user(AppUserCreateInput {
        username: "member-one".to_string(),
        password: "password-one".to_string(),
        display_name: None,
        role: Some(ROLE_MEMBER.to_string()),
        initial_balance_credit_micros: Some(2_000_000),
    })
    .expect("create member one");
    let user_two = create_app_user(AppUserCreateInput {
        username: "member-two".to_string(),
        password: "password-two".to_string(),
        display_name: None,
        role: Some(ROLE_MEMBER.to_string()),
        initial_balance_credit_micros: Some(2_000_000),
    })
    .expect("create member two");
    let key_one = apikey_create::create_api_key(
        Some("member one key".to_string()),
        Some("gpt-5-mini".to_string()),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("create key one");
    let key_two = apikey_create::create_api_key(
        Some("member two key".to_string()),
        Some("gpt-5-mini".to_string()),
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
        None,
    )
    .expect("create key two");
    set_api_key_owner(&key_one.id, "user", Some(&user_one.id), None).expect("own key one");
    set_api_key_owner(&key_two.id, "user", Some(&user_two.id), None).expect("own key two");

    let storage = storage_helpers::open_storage().expect("open storage");
    storage
        .insert_request_log_with_token_stat(
            &RequestLog {
                trace_id: Some("trace-one".to_string()),
                key_id: Some(key_one.id.clone()),
                request_path: "/v1/chat/completions".to_string(),
                method: "POST".to_string(),
                model: Some("gpt-5-mini".to_string()),
                status_code: Some(200),
                input_tokens: Some(40),
                cached_input_tokens: Some(10),
                output_tokens: Some(30),
                total_tokens: Some(70),
                estimated_cost_usd: Some(0.01),
                created_at: day_start + 10,
                ..RequestLog::default()
            },
            &RequestTokenStat {
                key_id: Some(key_one.id.clone()),
                model: Some("gpt-5-mini".to_string()),
                input_tokens: Some(40),
                cached_input_tokens: Some(10),
                output_tokens: Some(30),
                total_tokens: Some(70),
                estimated_cost_usd: Some(0.01),
                created_at: day_start + 10,
                ..RequestTokenStat::default()
            },
        )
        .expect("insert member one log");
    storage
        .insert_request_log_with_token_stat(
            &RequestLog {
                trace_id: Some("trace-two".to_string()),
                key_id: Some(key_two.id.clone()),
                request_path: "/v1/chat/completions".to_string(),
                method: "POST".to_string(),
                model: Some("gpt-5-mini".to_string()),
                status_code: Some(200),
                input_tokens: Some(400),
                cached_input_tokens: Some(0),
                output_tokens: Some(300),
                total_tokens: Some(700),
                estimated_cost_usd: Some(0.1),
                created_at: day_start + 20,
                ..RequestLog::default()
            },
            &RequestTokenStat {
                key_id: Some(key_two.id.clone()),
                model: Some("gpt-5-mini".to_string()),
                input_tokens: Some(400),
                output_tokens: Some(300),
                total_tokens: Some(700),
                estimated_cost_usd: Some(0.1),
                created_at: day_start + 20,
                ..RequestTokenStat::default()
            },
        )
        .expect("insert member two log");

    let resp = response_result(handle_request_with_actor(
        rpc_request(
            "dashboard/memberSummary",
            serde_json::json!({
                "dayStartTs": day_start,
                "dayEndTs": day_end
            }),
        ),
        RpcActor::from_parts(Some(ROLE_MEMBER), Some(&user_one.id)),
    ));

    assert!(resp.result.get("error").is_none(), "{:?}", resp.result);
    assert_eq!(resp.result["apiKeySummary"]["totalCount"], 1);
    assert_eq!(resp.result["usageToday"]["totalTokens"], 60);
    assert_eq!(resp.result["recentLogs"][0]["keyId"], key_one.id);
    assert_eq!(resp.result["topKeys"][0]["keyId"], key_one.id);
    assert_eq!(resp.result["topKeys"][0]["todayTokens"], 70);

    let _ = std::fs::remove_file(db_path);
}

#[test]
fn member_dashboard_no_key_returns_alert() {
    let _guard = test_env_guard();
    let db_path = setup_dashboard_test_db("codexmanager-member-dashboard-empty");
    let user = create_app_user(AppUserCreateInput {
        username: "member-empty".to_string(),
        password: "password-empty".to_string(),
        display_name: None,
        role: Some(ROLE_MEMBER.to_string()),
        initial_balance_credit_micros: None,
    })
    .expect("create member");

    let resp = response_result(handle_request_with_actor(
        rpc_request(
            "dashboard/memberSummary",
            serde_json::json!({
                "dayStartTs": 1_700_000_000,
                "dayEndTs": 1_700_086_400
            }),
        ),
        RpcActor::from_parts(Some(ROLE_MEMBER), Some(&user.id)),
    ));

    assert!(resp.result.get("error").is_none(), "{:?}", resp.result);
    assert_eq!(resp.result["apiKeySummary"]["totalCount"], 0);
    assert!(resp.result["alerts"]
        .as_array()
        .map(|items| items.iter().any(|item| item["kind"] == "no_api_key"))
        .unwrap_or(false));

    let _ = std::fs::remove_file(db_path);
}

#[test]
fn member_dashboard_ignores_requested_user_id() {
    let _guard = test_env_guard();
    let db_path = setup_dashboard_test_db("codexmanager-member-dashboard-user-id-spoof");
    let day_start = 1_700_000_000;
    let day_end = day_start + 86_400;
    let user_one = create_test_member("member-spoof-one", Some(2_000_000));
    let user_two = create_test_member("member-spoof-two", Some(2_000_000));
    let key_one = create_owned_test_api_key(&user_one.id, "member spoof one key", "gpt-5-mini");
    let key_two = create_owned_test_api_key(&user_two.id, "member spoof two key", "gpt-5-mini");

    insert_test_request_log(
        &key_one,
        "trace-spoof-one",
        "gpt-5-mini",
        200,
        12,
        2,
        8,
        0.01,
        day_start + 10,
    );
    insert_test_request_log(
        &key_two,
        "trace-spoof-two",
        "gpt-5-mini",
        200,
        1200,
        0,
        800,
        1.0,
        day_start + 20,
    );

    let resp = response_result(handle_request_with_actor(
        rpc_request(
            "dashboard/memberSummary",
            serde_json::json!({
                "userId": user_two.id,
                "dayStartTs": day_start,
                "dayEndTs": day_end
            }),
        ),
        RpcActor::from_parts(Some(ROLE_MEMBER), Some(&user_one.id)),
    ));

    assert!(resp.result.get("error").is_none(), "{:?}", resp.result);
    assert_eq!(resp.result["userId"], user_one.id);
    assert_eq!(resp.result["apiKeySummary"]["totalCount"], 1);
    assert_eq!(resp.result["usageToday"]["totalTokens"], 18);
    assert_eq!(resp.result["recentLogs"][0]["keyId"], key_one);
    assert_eq!(resp.result["topKeys"][0]["keyId"], key_one);
    assert_ne!(resp.result["recentLogs"][0]["keyId"], key_two);

    let _ = std::fs::remove_file(db_path);
}

#[test]
fn admin_member_dashboard_can_query_requested_user() {
    let _guard = test_env_guard();
    let db_path = setup_dashboard_test_db("codexmanager-admin-member-dashboard-debug");
    let day_start = 1_700_000_000;
    let day_end = day_start + 86_400;
    let user_one = create_test_member("admin-debug-one", Some(2_000_000));
    let user_two = create_test_member("admin-debug-two", Some(2_000_000));
    let key_one = create_owned_test_api_key(&user_one.id, "admin debug one key", "gpt-5-mini");
    let key_two = create_owned_test_api_key(&user_two.id, "admin debug two key", "gpt-5-mini");

    insert_test_request_log(
        &key_one,
        "trace-admin-debug-one",
        "gpt-5-mini",
        200,
        10,
        0,
        10,
        0.01,
        day_start + 10,
    );
    insert_test_request_log(
        &key_two,
        "trace-admin-debug-two",
        "gpt-5-mini",
        200,
        40,
        5,
        20,
        0.02,
        day_start + 20,
    );

    let resp = response_result(handle_request_with_actor(
        rpc_request(
            "dashboard/memberSummary",
            serde_json::json!({
                "userId": user_two.id,
                "dayStartTs": day_start,
                "dayEndTs": day_end
            }),
        ),
        RpcActor::system_admin(),
    ));

    assert!(resp.result.get("error").is_none(), "{:?}", resp.result);
    assert_eq!(resp.result["userId"], user_two.id);
    assert_eq!(resp.result["apiKeySummary"]["totalCount"], 1);
    assert_eq!(resp.result["usageToday"]["totalTokens"], 55);
    assert_eq!(resp.result["recentLogs"][0]["keyId"], key_two);
    assert_ne!(resp.result["recentLogs"][0]["keyId"], key_one);

    let _ = std::fs::remove_file(db_path);
}

#[test]
fn member_cannot_read_or_mutate_other_user_api_key() {
    let _guard = test_env_guard();
    let db_path = setup_dashboard_test_db("codexmanager-member-apikey-cross-user-deny");
    let user_one = create_test_member("apikey-deny-one", Some(2_000_000));
    let user_two = create_test_member("apikey-deny-two", Some(2_000_000));
    let key_one = create_owned_test_api_key(&user_one.id, "member one private key", "gpt-5-mini");
    let key_two = create_owned_test_api_key(&user_two.id, "member two private key", "gpt-5-mini");
    let actor_one = RpcActor::from_parts(Some(ROLE_MEMBER), Some(&user_one.id));

    for (method, params) in [
        ("apikey/readSecret", serde_json::json!({ "id": key_two })),
        (
            "apikey/updateModel",
            serde_json::json!({ "id": key_two, "name": "stolen", "modelSlug": "gpt-5" }),
        ),
        ("apikey/disable", serde_json::json!({ "id": key_two })),
        ("apikey/delete", serde_json::json!({ "id": key_two })),
    ] {
        let resp = response_result(handle_request_with_actor(
            rpc_request(method, params),
            actor_one.clone(),
        ));
        assert!(
            rpc_error(&resp).contains("permission_denied"),
            "{method} should deny cross-user access: {:?}",
            resp.result
        );
    }

    let member_one_list = response_result(handle_request_with_actor(
        rpc_request("apikey/list", serde_json::json!({})),
        actor_one,
    ));
    assert_eq!(member_one_list.result["items"].as_array().unwrap().len(), 1);
    assert_eq!(member_one_list.result["items"][0]["id"], key_one);

    let member_two_list = response_result(handle_request_with_actor(
        rpc_request("apikey/list", serde_json::json!({})),
        RpcActor::from_parts(Some(ROLE_MEMBER), Some(&user_two.id)),
    ));
    assert_eq!(member_two_list.result["items"].as_array().unwrap().len(), 1);
    assert_eq!(member_two_list.result["items"][0]["id"], key_two);
    assert_eq!(
        member_two_list.result["items"][0]["name"],
        "member two private key"
    );
    assert_eq!(member_two_list.result["items"][0]["status"], "active");

    let _ = std::fs::remove_file(db_path);
}

#[test]
fn member_created_api_key_ignores_admin_only_routing_fields() {
    let _guard = test_env_guard();
    let db_path = setup_dashboard_test_db("codexmanager-member-apikey-create-sanitizes");
    let user = create_test_member("apikey-create-sanitize", Some(2_000_000));
    let actor = RpcActor::from_parts(Some(ROLE_MEMBER), Some(&user.id));

    let created = response_result(handle_request_with_actor(
        rpc_request(
            "apikey/create",
            serde_json::json!({
                "name": "member safe key",
                "modelSlug": "gpt-5-mini",
                "rotationStrategy": "aggregate_api_rotation",
                "aggregateApiId": "agg-secret",
                "upstreamBaseUrl": "https://example.invalid/v1",
                "staticHeadersJson": "{\"x-admin\":\"secret\"}",
                "accountPlanFilter": "pro"
            }),
        ),
        actor.clone(),
    ));
    assert!(
        created.result.get("error").is_none(),
        "{:?}",
        created.result
    );

    let listed = response_result(handle_request_with_actor(
        rpc_request("apikey/list", serde_json::json!({})),
        actor,
    ));
    assert_eq!(listed.result["items"].as_array().unwrap().len(), 1);
    let item = &listed.result["items"][0];
    assert_eq!(item["id"], created.result["id"]);
    assert_eq!(item["rotationStrategy"], "account_rotation");
    assert!(item["aggregateApiId"].is_null());
    assert!(item["upstreamBaseUrl"].is_null());
    assert!(item["staticHeadersJson"].is_null());
    assert!(item["accountPlanFilter"].is_null());

    let _ = std::fs::remove_file(db_path);
}

#[test]
fn member_requestlog_queries_filter_to_owned_keys() {
    let _guard = test_env_guard();
    let db_path = setup_dashboard_test_db("codexmanager-member-requestlog-filter");
    let day_start = 1_700_000_000;
    let day_end = day_start + 86_400;
    let user_one = create_test_member("log-filter-one", Some(2_000_000));
    let user_two = create_test_member("log-filter-two", Some(2_000_000));
    let key_one = create_owned_test_api_key(&user_one.id, "log filter one key", "gpt-5-mini");
    let key_two = create_owned_test_api_key(&user_two.id, "log filter two key", "gpt-5-mini");
    let actor_one = RpcActor::from_parts(Some(ROLE_MEMBER), Some(&user_one.id));

    insert_test_request_log(
        &key_one,
        "trace-log-filter-one",
        "gpt-5-mini",
        200,
        30,
        10,
        20,
        0.03,
        day_start + 10,
    );
    insert_test_request_log(
        &key_two,
        "trace-log-filter-two",
        "gpt-5",
        500,
        300,
        0,
        200,
        0.3,
        day_start + 20,
    );

    let list = response_result(handle_request_with_actor(
        rpc_request(
            "requestlog/list",
            serde_json::json!({
                "page": 1,
                "pageSize": 20,
                "startTs": day_start,
                "endTs": day_end
            }),
        ),
        actor_one.clone(),
    ));
    assert!(list.result.get("error").is_none(), "{:?}", list.result);
    assert_eq!(list.result["total"], 1);
    assert_eq!(list.result["items"][0]["keyId"], key_one);

    let summary = response_result(handle_request_with_actor(
        rpc_request(
            "requestlog/summary",
            serde_json::json!({
                "page": 1,
                "pageSize": 20,
                "startTs": day_start,
                "endTs": day_end
            }),
        ),
        actor_one.clone(),
    ));
    assert!(
        summary.result.get("error").is_none(),
        "{:?}",
        summary.result
    );
    assert_eq!(summary.result["totalCount"], 1);
    assert_eq!(summary.result["filteredCount"], 1);
    assert_eq!(summary.result["successCount"], 1);
    assert_eq!(summary.result["errorCount"], 0);
    assert_eq!(summary.result["totalTokens"], 50);

    let today = response_result(handle_request_with_actor(
        rpc_request(
            "requestlog/today_summary",
            serde_json::json!({
                "dayStartTs": day_start,
                "dayEndTs": day_end
            }),
        ),
        actor_one.clone(),
    ));
    assert!(today.result.get("error").is_none(), "{:?}", today.result);
    assert_eq!(today.result["todayTokens"], 40);
    assert_eq!(today.result["estimatedCost"], 0.03);

    let clear = response_result(handle_request_with_actor(
        rpc_request("requestlog/clear", serde_json::json!({})),
        actor_one,
    ));
    assert!(
        rpc_error(&clear).contains("permission_denied"),
        "member must not clear global logs: {:?}",
        clear.result
    );

    let _ = std::fs::remove_file(db_path);
}
